import Event from '../../database/models/event.model.js';
import Ledger from "../../database/models/ledger.model.js";
import OperationalLog from "../../database/models/operationalLog.model.js";
import PaymentTransaction from "../../database/models/paymentTransaction.model.js";
import PartnerNotification from "../../database/models/partnerNotification.model.js";
import PartnerUser from "../../database/models/partnerUser.model.js";
import { finalizeEvent } from "../../service/eventFinalization.service.js";
import { parseEventReference } from "../../service/eventReference.service.js";
import { deriveEffectiveEventState } from "../../service/eventStatus.service.js";
import { sanitizeStructuredData } from "../../service/redaction.service.js";
import { resolveWithdrawalEligibility } from "../../service/withdrawalEligibility.service.js";

const clampNonNegative = (value) => Math.max(0, Number(value) || 0);
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeProcessedSavings = (event, savingsAmount) => {
    const normalized = clampNonNegative(savingsAmount);
    if (event.status === "PROCESSED" && (event.amount || 0) > 0) {
        return Math.max(1, normalized);
    }
    return normalized;
};

export const getPartnerEvents = async (req, res) => {
    try {
        const { name } = req.partner;
        const operatingMode =
            String(req.partner?.operatingMode || "demo").trim().toLowerCase() === "live"
                ? "live"
                : "demo";
        const savingsPercentage = Number(process.env.SAVINGS_PERCENTAGE ?? 0.1);
        const safeSavingsPercentage =
            Number.isFinite(savingsPercentage) && savingsPercentage > 0 && savingsPercentage <= 1
                ? savingsPercentage
                : 0.1;

        const { status } = req.query;
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

        const basePipeline = [
            { $match: { partnerName: name, operatingMode } },
            {
                $lookup: {
                    from: "paymenttransactions",
                    localField: "paymentTransactionId",
                    foreignField: "_id",
                    as: "paymentTransaction"
                }
            },
            {
                $unwind: {
                    path: "$paymentTransaction",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $addFields: {
                    rawStatus: "$status",
                    paymentStatus: "$paymentTransaction.status",
                    status: {
                        $switch: {
                            branches: [
                                { case: { $eq: ["$status", "PROCESSED"] }, then: "PROCESSED" },
                                { case: { $eq: ["$status", "FAILED"] }, then: "FAILED" },
                                { case: { $eq: ["$paymentTransaction.status", "SUCCESS"] }, then: "PROCESSED" },
                                { case: { $eq: ["$paymentTransaction.status", "FAILED"] }, then: "FAILED" },
                                {
                                    case: {
                                        $in: [
                                            "$paymentTransaction.status",
                                            ["PENDING", "INITIATED"]
                                        ]
                                    },
                                    then: "PROCESSING"
                                }
                            ],
                            default: "$status"
                        }
                    }
                }
            }
        ];

        if (status) {
            basePipeline.push({ $match: { status } });
        }

        const [events, totalResult] = await Promise.all([
            Event.aggregate([
                ...basePipeline,
                { $sort: { createdAt: -1 } },
                { $skip: (page - 1) * limit },
                { $limit: Number(limit) }
            ]),
            Event.aggregate([
                ...basePipeline,
                { $count: "total" }
            ])
        ]);
        const total = Number(totalResult[0]?.total || 0);

        const finalizePromises = events
            .map((event) => {
                const state = deriveEffectiveEventState({
                    event,
                    paymentTransaction: event.paymentTransaction || null
                });

                if (!state.shouldFinalize) {
                    return null;
                }

                return finalizeEvent({
                    eventId: event.eventId,
                    partnerName: event.partnerName,
                    operatingMode: event.operatingMode,
                    userId: event.userId,
                    paymentTransaction: event.paymentTransaction,
                    nextStatus: state.nextStatus,
                    failureReason: state.statusReason,
                    notifyPartner: true
                }).catch(() => null);
            })
            .filter(Boolean);
        await Promise.all(finalizePromises);

        const eventIds = events.map((e) => e.eventId);
        const savingsByEvent = eventIds.length
            ? await Ledger.aggregate([
                { $match: { account: "USER_SAVINGS", eventId: { $in: eventIds } } },
                { $group: { _id: "$eventId", savingsAmount: { $sum: "$amount" } } }
            ])
            : [];

        const savingsMap = new Map(savingsByEvent.map((x) => [x._id, clampNonNegative(x.savingsAmount)]));
        const enrichedEvents = events.map((event) => {
            const state = deriveEffectiveEventState({
                event,
                paymentTransaction: event.paymentTransaction || null
            });
            const fallbackSavings =
                state.effectiveStatus === "PROCESSED"
                    ? clampNonNegative(Math.round((event.amount || 0) * safeSavingsPercentage))
                    : 0;
            const rawSavings = savingsMap.get(event.eventId) ?? fallbackSavings;

            return {
                ...event,
                rawStatus: state.rawStatus,
                status: state.effectiveStatus,
                paymentStatus: state.paymentStatus,
                statusReason: state.statusReason,
                savingsAmount: normalizeProcessedSavings({ ...event, status: state.effectiveStatus }, rawSavings)
            };
        });

        return res.json({
            status: 'SUCCESS',
            page,
            limit,
            total,
            count: enrichedEvents.length,
            events: enrichedEvents
        });
    } catch (error) {
        return res.status(500).json({
            status: 'FAILED',
            reason: error.message
        });
    }
};

export const getPartnerAnalytics = async (req, res) => {
    try {
        const { name } = req.partner;
        const operatingMode =
            String(req.partner?.operatingMode || "demo").trim().toLowerCase() === "live"
                ? "live"
                : "demo";
        const savingsPercentage = Number(process.env.SAVINGS_PERCENTAGE ?? 0.1);
        const safeSavingsPercentage =
            Number.isFinite(savingsPercentage) && savingsPercentage > 0 && savingsPercentage <= 1
                ? savingsPercentage
                : 0.1;
        const partnerReferencePrefix = new RegExp(`^EVENT::${escapeRegex(name)}::${operatingMode}::`);
        const legacyLiveReferencePrefix = new RegExp(`^EVENT::${escapeRegex(name)}::(?!demo::|live::)`);
        const partnerReferenceMatch =
            operatingMode === "live"
                ? {
                    $or: [
                        { reference: partnerReferencePrefix },
                        { reference: legacyLiveReferencePrefix }
                    ]
                }
                : { reference: partnerReferencePrefix };
    
        const [stat, processedAmountAgg, totalSavingsAgg, partnerScopedWalletAgg] = await Promise.all([
            Event.aggregate([
                { $match: { partnerName: name, operatingMode } },
                {
                    $group: {
                        _id: "$status",
                        count: { $sum: 1 },
                        totalAmount: { $sum: "$amount" }
                    }
                }
            ]),
            Event.aggregate([
                { $match: { partnerName: name, operatingMode, status: "PROCESSED" } },
                { $group: { _id: null, totalProcessedAmount: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                { $match: { account: "USER_SAVINGS" } },
                {
                    $lookup: {
                        from: "events",
                        localField: "eventId",
                        foreignField: "eventId",
                        as: "event"
                    }
                },
                { $unwind: "$event" },
                {
                    $match: {
                        "event.partnerName": name,
                        "event.operatingMode": operatingMode,
                        "event.status": "PROCESSED"
                    }
                },
                { $group: { _id: null, totalSavings: { $sum: "$amount" } } }
            ]),
            Ledger.aggregate([
                {
                    $match: {
                        account: "USER_WALLET_LIABILITY",
                        userId: { $type: "objectId" },
                        ...partnerReferenceMatch
                    }
                },
                {
                    $group: {
                        _id: "$userId",
                        partnerAttributedBalance: { $sum: "$amount" }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalWalletBalance: { $sum: "$partnerAttributedBalance" }
                    }
                }
            ])
        ]);
    
        const processedAmount = clampNonNegative(processedAmountAgg[0]?.totalProcessedAmount);
        const ledgerSavings = clampNonNegative(totalSavingsAgg[0]?.totalSavings);

        return res.json({
            status: 'SUCCESS',
            stat,
            totalProcessedAmount: processedAmount,
            totalSavings: ledgerSavings || clampNonNegative(Math.round(processedAmount * safeSavingsPercentage)),
            totalWalletBalance: clampNonNegative(partnerScopedWalletAgg[0]?.totalWalletBalance)
        });
    } catch (error) {
        return res.status(500).json({
            status: 'FAILED',
            reason: error.message
        });
    }
};

export const getPartnerSavingsBehavior = async (req, res) => {
    try {
        const { name } = req.partner;
        const operatingMode =
            String(req.partner?.operatingMode || "demo").trim().toLowerCase() === "live"
                ? "live"
                : "demo";
        const savingsPercentage = Number(process.env.SAVINGS_PERCENTAGE ?? 0.1);
        const safeSavingsPercentage =
            Number.isFinite(savingsPercentage) && savingsPercentage > 0 && savingsPercentage <= 1
                ? savingsPercentage
                : 0.1;

        const [summaryAgg, behavior, processedEventsByUser] = await Promise.all([
            Ledger.aggregate([
                { $match: { account: "USER_SAVINGS" } },
                {
                    $lookup: {
                        from: "events",
                        localField: "eventId",
                        foreignField: "eventId",
                        as: "event"
                    }
                },
                { $unwind: "$event" },
                {
                    $match: {
                        "event.partnerName": name,
                        "event.operatingMode": operatingMode,
                        "event.status": "PROCESSED"
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalSavings: { $sum: "$amount" },
                        savingsEntries: { $sum: 1 },
                        uniqueUsers: { $addToSet: "$userId" }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        totalSavings: 1,
                        savingsEntries: 1,
                        uniqueUsers: { $size: "$uniqueUsers" }
                    }
                }
            ]),
            Ledger.aggregate([
                { $match: { account: "USER_SAVINGS", userId: { $type: "objectId" } } },
                {
                    $lookup: {
                        from: "events",
                        localField: "eventId",
                        foreignField: "eventId",
                        as: "event"
                    }
                },
                { $unwind: "$event" },
                {
                    $match: {
                        "event.partnerName": name,
                        "event.operatingMode": operatingMode,
                        "event.status": "PROCESSED"
                    }
                },
                {
                    $group: {
                        _id: "$userId",
                        totalSaved: { $sum: "$amount" },
                        savingsEvents: { $sum: 1 },
                        lastSavedAt: { $max: "$createdAt" }
                    }
                },
                { $sort: { totalSaved: -1 } },
                { $limit: 50 },
                {
                    $lookup: {
                        from: "users",
                        localField: "_id",
                        foreignField: "_id",
                        as: "user"
                    }
                },
                { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 0,
                        userId: "$_id",
                        phoneNumber: "$user.phoneNumber",
                        totalSaved: 1,
                        savingsEvents: 1,
                        lastSavedAt: 1
                    }
                }
            ]),
            Event.aggregate([
                {
                    $match: {
                        partnerName: name,
                        operatingMode,
                        status: "PROCESSED",
                        userId: { $type: "objectId" }
                    }
                },
                {
                    $group: {
                        _id: "$userId",
                        totalAmount: { $sum: "$amount" },
                        processedEvents: { $sum: 1 },
                        lastSavedAt: { $max: "$createdAt" }
                    }
                },
                {
                    $lookup: {
                        from: "users",
                        localField: "_id",
                        foreignField: "_id",
                        as: "user"
                    }
                },
                { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 0,
                        userId: "$_id",
                        phoneNumber: "$user.phoneNumber",
                        totalSaved: { $round: [{ $multiply: ["$totalAmount", safeSavingsPercentage] }, 0] },
                        savingsEvents: "$processedEvents",
                        lastSavedAt: 1
                    }
                },
                { $sort: { totalSaved: -1 } },
                { $limit: 50 }
            ])
        ]);

        const summary = summaryAgg[0] || { totalSavings: 0, savingsEntries: 0, uniqueUsers: 0 };
        const effectiveUsers = behavior.length ? behavior : processedEventsByUser;
        const totalFromUsers = effectiveUsers.reduce((sum, user) => sum + clampNonNegative(user.totalSaved), 0);
        const entriesFromUsers = effectiveUsers.reduce((sum, user) => sum + (Number(user.savingsEvents) || 0), 0);

        return res.json({
            status: "SUCCESS",
            summary: {
                totalSavings: clampNonNegative(summary.totalSavings) || clampNonNegative(totalFromUsers),
                savingsEntries: summary.savingsEntries || entriesFromUsers,
                uniqueUsers: summary.uniqueUsers || effectiveUsers.length
            },
            users: effectiveUsers.map((user) => ({
                ...user,
                totalSaved: clampNonNegative(user.totalSaved)
            }))
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getPartnerUsers = async (req, res) => {
    try {
        const partnerId = req.partner.id;
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const userQuery = { partnerId, status: { $in: ["PENDING", "VERIFIED", "ACTIVE"] } };
        const [partnerUsers, total] = await Promise.all([
            PartnerUser.find(userQuery)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            PartnerUser.countDocuments(userQuery)
        ]);

        return res.json({
            status: "SUCCESS",
            page,
            limit,
            total,
            users: partnerUsers
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getPartnerUserDemoState = async (req, res) => {
    try {
        const partnerId = req.partner.id;
        const partnerName = req.partner.name;
        const operatingMode =
            String(req.partner?.operatingMode || "demo").trim().toLowerCase() === "live"
                ? "live"
                : "demo";
        const requestedUserId = String(req.query.userId || "").trim();
        const requestedPhone = String(req.query.phone || "").trim();

        if (!requestedUserId && !requestedPhone) {
            return res.status(400).json({
                status: "FAILED",
                reason: "userId or phone is required"
            });
        }

        const partnerUserQuery = { partnerId };
        if (requestedUserId) {
            partnerUserQuery.userId = requestedUserId;
        } else {
            partnerUserQuery.phoneNumber = requestedPhone;
        }

        const partnerUser = await PartnerUser.findOne(partnerUserQuery)
            .sort({ createdAt: -1 })
            .lean();

        if (!partnerUser) {
            return res.status(404).json({
                status: "FAILED",
                reason: "Partner-linked user not found"
            });
        }

        const eventReferencePrefix = new RegExp(`^EVENT::${escapeRegex(partnerName)}::${operatingMode}::`);
        const [events, depositTransactions, withdrawalTransactions, attributedWalletBalanceAgg, walletAttributionEntries, withdrawalPolicy] = await Promise.all([
            Event.find({
                userId: partnerUser.userId,
                partnerName,
                operatingMode
            })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
            PaymentTransaction.find({
                userId: partnerUser.userId,
                type: "DEPOSIT",
                externalRef: eventReferencePrefix
            })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
            PaymentTransaction.find({
                userId: partnerUser.userId,
                type: "WITHDRAWAL",
                $or: [
                    { partnerId },
                    { partnerName }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
            Ledger.aggregate([
                {
                    $match: {
                        userId: partnerUser.userId,
                        account: "USER_WALLET_LIABILITY",
                        reference: eventReferencePrefix
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: "$amount" }
                    }
                }
            ]),
            Ledger.find({
                userId: partnerUser.userId,
                account: "USER_WALLET_LIABILITY",
                reference: /^EVENT::/
            })
                .select("amount reference createdAt")
                .lean(),
            resolveWithdrawalEligibility({ userId: partnerUser.userId })
        ]);

        const eventIds = events.map((event) => event.eventId);
        const savingsTransactions = eventIds.length
            ? await Ledger.find({
                userId: partnerUser.userId,
                account: "USER_SAVINGS",
                eventId: { $in: eventIds }
            })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean()
            : [];

        const totalSaved = savingsTransactions.reduce((sum, row) => sum + clampNonNegative(row.amount), 0);
        const processedEvents = events.filter((event) => event.status === "PROCESSED");
        const totalProcessedEventAmount = processedEvents.reduce(
            (sum, event) => sum + clampNonNegative(event.amount),
            0
        );
        const savingsByPlatformMap = new Map();
        walletAttributionEntries.forEach((entry) => {
            const parsed = parseEventReference(entry.reference);
            if (!parsed?.partnerName) {
                return;
            }

            const existing = savingsByPlatformMap.get(parsed.partnerName) || {
                partnerName: parsed.partnerName,
                totalSaved: 0,
                entries: 0,
                byMode: {
                    live: 0,
                    demo: 0
                }
            };
            const amount = clampNonNegative(entry.amount);
            existing.totalSaved += amount;
            existing.entries += 1;
            existing.byMode[parsed.operatingMode === "demo" ? "demo" : "live"] += amount;
            savingsByPlatformMap.set(parsed.partnerName, existing);
        });
        const byPlatform = [...savingsByPlatformMap.values()]
            .map((row) => ({
                ...row,
                totalSaved: clampNonNegative(row.totalSaved),
                byMode: {
                    live: clampNonNegative(row.byMode.live),
                    demo: clampNonNegative(row.byMode.demo)
                }
            }))
            .sort((left, right) => right.totalSaved - left.totalSaved);
        const cumulativeTotalSaved = byPlatform.reduce((sum, row) => sum + clampNonNegative(row.totalSaved), 0);
        const currentPlatform =
            byPlatform.find((row) => row.partnerName === partnerName) || {
                partnerName,
                totalSaved: clampNonNegative(attributedWalletBalanceAgg[0]?.total),
                entries: 0,
                byMode: {
                    live: operatingMode === "live" ? clampNonNegative(attributedWalletBalanceAgg[0]?.total) : 0,
                    demo: operatingMode === "demo" ? clampNonNegative(attributedWalletBalanceAgg[0]?.total) : 0
                }
            };

        const paymentTransactions = [...depositTransactions, ...withdrawalTransactions]
            .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
            .slice(0, 30);
        const withdrawalTransactionIds = withdrawalTransactions
            .map((transaction) => transaction?._id)
            .filter(Boolean);
        const recentWithdrawalLogs = await OperationalLog.find({
            category: "PAYMENT",
            action: /^WITHDRAWAL_/,
            userId: partnerUser.userId,
            $or: [
                { partnerName },
                ...(withdrawalTransactionIds.length
                    ? [{ paymentTransactionId: { $in: withdrawalTransactionIds } }]
                    : [])
            ]
        })
            .sort({ createdAt: -1 })
            .limit(15)
            .lean();

        return res.json({
            status: "SUCCESS",
            operatingMode,
            partnerUser,
            summary: {
                partnerAttributedWalletBalance: clampNonNegative(attributedWalletBalanceAgg[0]?.total),
                totalSaved,
                processedEventCount: processedEvents.length,
                totalProcessedEventAmount,
                savings: {
                    totalSaved: clampNonNegative(cumulativeTotalSaved || totalSaved),
                    entries: byPlatform.reduce((sum, row) => sum + (Number(row.entries) || 0), 0) || savingsTransactions.length,
                    cumulativeTotalSaved: clampNonNegative(cumulativeTotalSaved),
                    byPlatform,
                    currentPlatform
                }
            },
            withdrawalPolicy: {
                ...withdrawalPolicy,
                canPartnerInitiateWithdrawal: Boolean(withdrawalPolicy?.eligible)
            },
            events,
            savingsTransactions,
            paymentTransactions,
            recentWithdrawalLogs: recentWithdrawalLogs.map((log) => ({
                _id: log._id,
                createdAt: log.createdAt,
                level: log.level,
                action: log.action,
                status: log.status,
                message: log.message,
                paymentTransactionId: log.paymentTransactionId || null,
                withdrawalRequestId: log.withdrawalRequestId || null,
                metadata: sanitizeStructuredData(log.metadata || {})
            }))
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getPartnerNotifications = async (req, res) => {
    try {
        const partnerId = req.partner.id;
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [notifications, total] = await Promise.all([
            PartnerNotification.find({ partnerId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            PartnerNotification.countDocuments({ partnerId })
        ]);

        return res.json({
            status: "SUCCESS",
            page,
            limit,
            total,
            notifications
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getPartnerNotificationSummary = async (req, res) => {
    try {
        const partnerId = req.partner.id;
        const unreadCount = await PartnerNotification.countDocuments({
            partnerId,
            read: { $ne: true }
        });

        return res.json({
            status: "SUCCESS",
            unreadCount
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const markPartnerNotificationsRead = async (req, res) => {
    try {
        const partnerId = req.partner.id;
        const result = await PartnerNotification.updateMany(
            { partnerId, read: { $ne: true } },
            { $set: { read: true } }
        );

        return res.json({
            status: "SUCCESS",
            updated: result.modifiedCount || 0
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};
