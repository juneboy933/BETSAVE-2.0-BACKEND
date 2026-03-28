import Event from "../../database/models/event.model.js";
import Ledger from "../../database/models/ledger.model.js";
import Partner from "../../database/models/partner.model.js";
import PartnerUser from "../../database/models/partnerUser.model.js";
import PaymentTransaction from "../../database/models/paymentTransaction.model.js";
import User from "../../database/models/user.model.js";
import Wallet from "../../database/models/wallet.model.js";
import WorkerStatus from "../../database/models/workerStatus.model.js";
import mongoose from "mongoose";
import { sendpartnerWebhook } from "../../service/notifyPartner.service.js";
import PartnerNotification from "../../database/models/partnerNotification.model.js";
import AdminNotification from "../../database/models/adminNotification.model.js";
import OperationalLog from "../../database/models/operationalLog.model.js";
import ReconciliationRun from "../../database/models/reconciliationRun.model.js";
import { supportsTransactions } from "../../service/databaseSession.service.js";
import { isDarajaCollectionEnabled, isDarajaDisbursementEnabled } from "../../service/daraja.client.js";
import { parseEventReference } from "../../service/eventReference.service.js";
import { runPaybillSettlementReconciliation } from "../../service/paymentSettlement.service.js";
import { maskPhoneForDisplay, sanitizeStructuredData, summarizeUrlForDisplay } from "../../service/redaction.service.js";

const parsePagination = (query) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    return { page, limit };
};

const clampNonNegative = (value) => Math.max(0, Number(value) || 0);
const parsePositiveNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};
const normalizeOperatingMode = (value) => {
    const mode = String(value || "").trim().toLowerCase();
    return mode === "demo" ? "demo" : "live";
};
const normalizeSettlementScope = (externalRef) => {
    const mode = String(parseEventReference(externalRef)?.operatingMode || "").trim().toLowerCase();
    if (mode === "demo") return "demo";
    if (mode === "live") return "live";
    return "unscoped";
};
const describeWebhook = (webhookUrl) => {
    const normalized = String(webhookUrl || "").trim();
    if (!normalized) {
        return {
            webhookConfigured: false,
            webhookHost: null,
            webhookSecure: false
        };
    }

    return {
        webhookConfigured: true,
        webhookHost: summarizeUrlForDisplay(normalized),
        webhookSecure: /^https:\/\//i.test(normalized)
    };
};
const resolveAdminViewMode = (req) => normalizeOperatingMode(req?.query?.operatingMode);
const WORKER_HEARTBEAT_INTERVAL_MS = 30000;
const WORKER_HEALTH_GRACE_MS = 15000;

const logAdminDecision = async (req, payload) => {
    try {
        await AdminNotification.create({
            ...payload,
            actorName: req.admin?.name || "Admin",
            actorEmail: req.admin?.email || null
        });
    } catch (error) {
        console.error("Failed to log admin decision:", error.message);
    }
};

export const getAdminOverview = async (req, res) => {
    try {
        const operatingMode = resolveAdminViewMode(req);
        const savingsPercentage = Number(process.env.SAVINGS_PERCENTAGE ?? 0.1);
        const safeSavingsPercentage =
            Number.isFinite(savingsPercentage) && savingsPercentage > 0 && savingsPercentage <= 1
                ? savingsPercentage
                : 0.1;

        const [
            totalUsers,
            activeUsers,
            totalPartners,
            activePartners,
            totalProcessedEvents,
            totalProcessedAmount,
            totalWalletBalance,
            totalSavingsLedger,
            eventByStatus
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ status: "ACTIVE" }),
            Partner.countDocuments(),
            Partner.countDocuments({ status: "ACTIVE" }),
            Event.countDocuments({ status: "PROCESSED", operatingMode }),
            Event.aggregate([
                { $match: { status: "PROCESSED", operatingMode } },
                { $group: { _id: null, totalAmount: { $sum: "$amount" } } }
            ]),
            Wallet.aggregate([
                { $match: { balance: { $gt: 0 } } },
                {
                    $lookup: {
                        from: "events",
                        let: { walletUserId: "$userId" },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ["$userId", "$$walletUserId"] },
                                            { $eq: ["$status", "PROCESSED"] },
                                            { $eq: ["$operatingMode", operatingMode] }
                                        ]
                                    }
                                }
                            },
                            { $limit: 1 }
                        ],
                        as: "processedEvent"
                    }
                },
                { $match: { processedEvent: { $ne: [] } } },
                { $group: { _id: null, balance: { $sum: "$balance" } } }
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
                        "event.status": "PROCESSED",
                        "event.operatingMode": operatingMode
                    }
                },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Event.aggregate([
                { $match: { operatingMode } },
                {
                    $group: {
                        _id: "$status",
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        return res.json({
            status: "SUCCESS",
            metrics: {
                totalUsers,
                activeUsers,
                totalPartners,
                activePartners,
                totalEvents: totalProcessedEvents,
                totalProcessedAmount: clampNonNegative(totalProcessedAmount[0]?.totalAmount),
                totalWalletBalance: clampNonNegative(totalWalletBalance[0]?.balance),
                totalSavingsLedger:
                    clampNonNegative(totalSavingsLedger[0]?.total) ||
                    clampNonNegative(Math.round((totalProcessedAmount[0]?.totalAmount || 0) * safeSavingsPercentage))
            },
            eventByStatus
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getAdminPartners = async (req, res) => {
    try {
        const operatingMode = resolveAdminViewMode(req);
        const { page, limit } = parsePagination(req.query);
        const skip = (page - 1) * limit;

        const [partners, eventStats, savingsStats, total] = await Promise.all([
            Partner.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select("name status webhookUrl createdAt")
                .lean(),
            Event.aggregate([
                { $match: { operatingMode } },
                {
                    $group: {
                        _id: "$partnerName",
                        totalEvents: { $sum: 1 },
                        processedEvents: {
                            $sum: {
                                $cond: [{ $eq: ["$status", "PROCESSED"] }, 1, 0]
                            }
                        },
                        failedEvents: {
                            $sum: {
                                $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0]
                            }
                        },
                        totalAmount: {
                            $sum: {
                                $cond: [{ $eq: ["$status", "PROCESSED"] }, "$amount", 0]
                            }
                        }
                    }
                }
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
                        "event.status": "PROCESSED",
                        "event.operatingMode": operatingMode
                    }
                },
                {
                    $group: {
                        _id: "$event.partnerName",
                        totalSavings: { $sum: "$amount" }
                    }
                }
            ]),
            Partner.countDocuments()
        ]);

        const statsByName = new Map(eventStats.map((stat) => [stat._id, stat]));
        const savingsByName = new Map(savingsStats.map((stat) => [stat._id, stat.totalSavings]));
        const data = partners.map((partner) => {
            const stat = statsByName.get(partner.name);
            return {
                _id: partner._id,
                name: partner.name,
                status: partner.status,
                createdAt: partner.createdAt,
                ...describeWebhook(partner.webhookUrl),
                stats: {
                    totalEvents: stat?.totalEvents || 0,
                    processedEvents: stat?.processedEvents || 0,
                    failedEvents: stat?.failedEvents || 0,
                    totalAmount: stat?.totalAmount || 0,
                    totalSavings: clampNonNegative(savingsByName.get(partner.name))
                }
            };
        });

        return res.json({
            status: "SUCCESS",
            page,
            limit,
            total,
            partners: data
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getAdminPartnerDetails = async (req, res) => {
    try {
        const operatingMode = resolveAdminViewMode(req);
        const { partnerId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(partnerId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid partner id"
            });
        }

        const objectPartnerId = new mongoose.Types.ObjectId(partnerId);
        const partner = await Partner.findById(objectPartnerId)
            .select("_id name status operatingMode webhookUrl createdAt updatedAt")
            .lean();

        if (!partner) {
            return res.status(404).json({
                status: "FAILED",
                reason: "Partner not found"
            });
        }

        const [eventStats, partnerUsers, savingsAgg, recentEvents] = await Promise.all([
            Event.aggregate([
                { $match: { partnerName: partner.name, operatingMode } },
                {
                    $group: {
                        _id: "$status",
                        count: { $sum: 1 },
                        totalAmount: { $sum: "$amount" }
                    }
                }
            ]),
            PartnerUser.countDocuments({ partnerId: objectPartnerId }),
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
                { $match: { "event.partnerName": partner.name, "event.operatingMode": operatingMode } },
                {
                    $group: {
                        _id: null,
                        totalSavings: { $sum: "$amount" },
                        entries: { $sum: 1 }
                    }
                }
            ]),
            Event.find({ partnerName: partner.name, operatingMode })
                .sort({ createdAt: -1 })
                .limit(10)
                .select("eventId phone status amount createdAt")
                .lean()
        ]);

        return res.json({
            status: "SUCCESS",
            stats: eventStats,
            partnerUsers,
            savings: {
                totalSavings: clampNonNegative(savingsAgg[0]?.totalSavings),
                entries: savingsAgg[0]?.entries || 0
            },
            recentEvents: recentEvents.map((event) => ({
                ...event,
                phone: maskPhoneForDisplay(event.phone)
            })),
            partner: {
                _id: partner._id,
                name: partner.name,
                status: partner.status,
                operatingMode: partner.operatingMode,
                createdAt: partner.createdAt,
                updatedAt: partner.updatedAt,
                ...describeWebhook(partner.webhookUrl)
            }
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getAdminUsers = async (req, res) => {
    try {
        const { page, limit } = parsePagination(req.query);
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            User.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select("phoneNumber verified status createdAt")
                .lean(),
            User.countDocuments()
        ]);

        const userIds = users.map((user) => user._id);
        const partnerLinks = userIds.length
            ? await PartnerUser.find({ userId: { $in: userIds } })
                .select("userId partnerName status source autoSavingsEnabled createdAt")
                .sort({ createdAt: -1 })
                .lean()
            : [];

        const partnerMembershipsByUserId = new Map();
        partnerLinks.forEach((link) => {
            const key = String(link.userId);
            const current = partnerMembershipsByUserId.get(key) || new Map();
            const partnerKey = String(link.partnerName || "").trim();
            if (!partnerKey) return;
            if (!current.has(partnerKey)) {
                current.set(partnerKey, {
                    name: partnerKey,
                    status: link.status || "UNKNOWN",
                    source: link.source || "UNKNOWN",
                    autoSavingsEnabled: Boolean(link.autoSavingsEnabled),
                    linkedAt: link.createdAt || null
                });
            }
            partnerMembershipsByUserId.set(key, current);
        });

        const enrichedUsers = users.map((user) => {
            const membershipsMap = partnerMembershipsByUserId.get(String(user._id)) || new Map();
            const partnerMemberships = [...membershipsMap.values()];
            const partners = partnerMemberships.map((membership) => membership.name);
            return {
                ...user,
                partners,
                partnerCount: partners.length,
                partnerMemberships
            };
        });

        return res.json({
            status: "SUCCESS",
            page,
            limit,
            total,
            users: enrichedUsers
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getAdminUserSavingsBreakdown = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid user id"
            });
        }

        const objectUserId = new mongoose.Types.ObjectId(userId);

        const [user, wallet, totals, byPartner] = await Promise.all([
            User.findById(objectUserId).select("_id phoneNumber status").lean(),
            Wallet.findOne({ userId: objectUserId }).select("balance").lean(),
            Ledger.aggregate([
                { $match: { userId: objectUserId, account: "USER_SAVINGS" } },
                {
                    $group: {
                        _id: null,
                        totalSaved: { $sum: "$amount" },
                        entries: { $sum: 1 }
                    }
                }
            ]),
            Ledger.aggregate([
                { $match: { userId: objectUserId, account: "USER_SAVINGS" } },
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
                    $group: {
                        _id: "$event.partnerName",
                        totalSaved: { $sum: "$amount" },
                        entries: { $sum: 1 }
                    }
                },
                { $sort: { totalSaved: -1 } }
            ])
        ]);

        if (!user) {
            return res.status(404).json({
                status: "FAILED",
                reason: "User not found"
            });
        }

        const summary = totals[0] || { totalSaved: 0, entries: 0 };
        const safeByPartner = byPartner.map((item) => ({
            partnerName: item._id || "UNKNOWN",
            totalSaved: clampNonNegative(item.totalSaved),
            entries: item.entries || 0
        }));

        return res.json({
            status: "SUCCESS",
            user,
            walletBalance: clampNonNegative(wallet?.balance),
            totalSaved: clampNonNegative(summary.totalSaved),
            totalEntries: summary.entries || 0,
            byPartner: safeByPartner
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const updatePartnerStatus = async (req, res) => {
    try {
        const { partnerId } = req.params;
        const { status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(partnerId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid partner id"
            });
        }

        if (!["ACTIVE", "SUSPENDED"].includes(status)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Status must be ACTIVE or SUSPENDED"
            });
        }

        const partner = await Partner.findByIdAndUpdate(
            partnerId,
            { $set: { status } },
            { returnDocument: "after" }
        ).select("name status webhookUrl updatedAt");

        if (!partner) {
            return res.status(404).json({
                status: "FAILED",
                reason: "Partner not found"
            });
        }

        await logAdminDecision(req, {
            action: "PARTNER_STATUS_UPDATED",
            title: "Partner Status Updated",
            message: `Partner ${partner.name} status changed to ${partner.status}.`,
            targetType: "PARTNER",
            targetId: String(partnerId),
            metadata: {
                status: partner.status,
                webhookUrl: partner.webhookUrl
            }
        });

        return res.json({
            status: "SUCCESS",
            partner
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const suspendUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason, photoUrl, notifyPartners } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid user id"
            });
        }

        const normalizedReason = String(reason || "").trim();
        if (!normalizedReason) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Suspension reason is required"
            });
        }

        const normalizedPhotoUrl = String(photoUrl || "").trim();
        const shouldNotifyPartners = Boolean(notifyPartners);

        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    status: "SUSPENDED",
                    suspension: {
                        reason: normalizedReason,
                        photoUrl: normalizedPhotoUrl || null,
                        notifyPartners: shouldNotifyPartners,
                        suspendedAt: new Date()
                    }
                }
            },
            { returnDocument: "after" }
        ).select("_id phoneNumber status suspension");

        if (!user) {
            return res.status(404).json({
                status: "FAILED",
                reason: "User not found"
            });
        }

        const partnerLinks = await PartnerUser.find({ userId: user._id })
            .select("partnerId partnerName")
            .lean();

        const uniquePartners = [
            ...new Map(
                partnerLinks
                    .filter((link) => link.partnerId && link.partnerName)
                    .map((link) => [String(link.partnerId), link])
            ).values()
        ];
        const uniquePartnerNames = uniquePartners.map((partner) => partner.partnerName);

        await PartnerUser.updateMany(
            { userId: user._id },
            { $set: { status: "SUSPENDED" } }
        );

        let notifiedPartners = 0;
        if (shouldNotifyPartners && uniquePartnerNames.length) {
            await PartnerNotification.insertMany(
                uniquePartners.map((partner) => ({
                    partnerId: partner.partnerId,
                    partnerName: partner.partnerName,
                    type: "USER_SUSPENDED",
                    title: "User Suspended By Admin",
                    message: `User ${user.phoneNumber} was suspended by admin. Reason: ${normalizedReason}`,
                    payload: {
                        userId: String(user._id),
                        phoneNumber: user.phoneNumber,
                        reason: normalizedReason,
                        photoUrl: normalizedPhotoUrl || null,
                        suspendedAt: user.suspension?.suspendedAt || new Date().toISOString()
                    },
                    source: "ADMIN"
                }))
            );

            await Promise.all(
                uniquePartnerNames.map(async (partnerName) => {
                    await sendpartnerWebhook({
                        partnerName,
                        payload: {
                            eventType: "USER_SUSPENDED",
                            occurredAt: new Date().toISOString(),
                            user: {
                                id: String(user._id),
                                phoneNumber: user.phoneNumber,
                                status: user.status,
                                photoUrl: user.suspension?.photoUrl || null
                            },
                            reason: user.suspension?.reason || normalizedReason
                        }
                    });
                })
            );
            notifiedPartners = uniquePartnerNames.length;
        }

        await logAdminDecision(req, {
            action: "USER_SUSPENDED",
            title: "User Suspended",
            message: `User ${user.phoneNumber} was suspended.`,
            targetType: "USER",
            targetId: String(user._id),
            metadata: {
                reason: normalizedReason,
                notifyPartners: shouldNotifyPartners,
                partnerCount: uniquePartnerNames.length,
                notifiedPartners
            }
        });

        return res.json({
            status: "SUCCESS",
            user,
            partnerCount: uniquePartnerNames.length,
            notifiedPartners
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const activateUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { notifyPartners } = req.body || {};

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid user id"
            });
        }

        const shouldNotifyPartners = Boolean(notifyPartners);
        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    status: "ACTIVE",
                    "suspension.notifyPartners": shouldNotifyPartners
                },
                $unset: {
                    "suspension.reason": 1,
                    "suspension.photoUrl": 1,
                    "suspension.suspendedAt": 1
                }
            },
            { returnDocument: "after" }
        ).select("_id phoneNumber status");

        if (!user) {
            return res.status(404).json({
                status: "FAILED",
                reason: "User not found"
            });
        }

        const partnerLinks = await PartnerUser.find({ userId: user._id })
            .select("partnerId partnerName")
            .lean();

        const uniquePartners = [
            ...new Map(
                partnerLinks
                    .filter((link) => link.partnerId && link.partnerName)
                    .map((link) => [String(link.partnerId), link])
            ).values()
        ];
        const uniquePartnerNames = uniquePartners.map((partner) => partner.partnerName);

        await PartnerUser.updateMany(
            { userId: user._id },
            { $set: { status: "ACTIVE" } }
        );

        let notifiedPartners = 0;
        if (shouldNotifyPartners && uniquePartnerNames.length) {
            await PartnerNotification.insertMany(
                uniquePartners.map((partner) => ({
                    partnerId: partner.partnerId,
                    partnerName: partner.partnerName,
                    type: "USER_ACTIVATED",
                    title: "User Reactivated By Admin",
                    message: `User ${user.phoneNumber} was reactivated by admin.`,
                    payload: {
                        userId: String(user._id),
                        phoneNumber: user.phoneNumber,
                        activatedAt: new Date().toISOString()
                    },
                    source: "ADMIN"
                }))
            );

            await Promise.all(
                uniquePartnerNames.map(async (partnerName) => {
                    await sendpartnerWebhook({
                        partnerName,
                        payload: {
                            eventType: "USER_ACTIVATED",
                            occurredAt: new Date().toISOString(),
                            user: {
                                id: String(user._id),
                                phoneNumber: user.phoneNumber,
                                status: user.status
                            }
                        }
                    });
                })
            );
            notifiedPartners = uniquePartnerNames.length;
        }

        await logAdminDecision(req, {
            action: "USER_ACTIVATED",
            title: "User Activated",
            message: `User ${user.phoneNumber} was activated.`,
            targetType: "USER",
            targetId: String(user._id),
            metadata: {
                notifyPartners: shouldNotifyPartners,
                partnerCount: uniquePartnerNames.length,
                notifiedPartners
            }
        });

        return res.json({
            status: "SUCCESS",
            user,
            partnerCount: uniquePartnerNames.length,
            notifiedPartners
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getAdminNotifications = async (req, res) => {
    try {
        const { page, limit } = parsePagination(req.query);
        const skip = (page - 1) * limit;

        const [notifications, total] = await Promise.all([
            AdminNotification.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AdminNotification.countDocuments()
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

export const getAdminNotificationSummary = async (_req, res) => {
    try {
        const unreadCount = await AdminNotification.countDocuments({ read: { $ne: true } });
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

export const markAdminNotificationsRead = async (_req, res) => {
    try {
        const result = await AdminNotification.updateMany(
            { read: { $ne: true } },
            { $set: { read: true, readAt: new Date() } }
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

export const getAdminEvents = async (req, res) => {
    try {
        const operatingMode = resolveAdminViewMode(req);
        const { page, limit } = parsePagination(req.query);
        const skip = (page - 1) * limit;
        const savingsPercentage = Number(process.env.SAVINGS_PERCENTAGE ?? 0.1);
        const safeSavingsPercentage =
            Number.isFinite(savingsPercentage) && savingsPercentage > 0 && savingsPercentage <= 1
                ? savingsPercentage
                : 0.1;

        const query = { operatingMode };
        if (req.query.status) query.status = req.query.status;
        if (req.query.partnerName) query.partnerName = String(req.query.partnerName || "").trim();
        if (req.query.phone) query.phone = req.query.phone;

        const [events, total] = await Promise.all([
            Event.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Event.countDocuments(query)
        ]);

        const eventIds = events.map((event) => event.eventId);
        const savingsByEvent = eventIds.length
            ? await Ledger.aggregate([
                { $match: { account: "USER_SAVINGS", eventId: { $in: eventIds } } },
                { $group: { _id: "$eventId", savingsAmount: { $sum: "$amount" } } }
            ])
            : [];

        const savingsMap = new Map(
            savingsByEvent.map((item) => [item._id, clampNonNegative(item.savingsAmount)])
        );
        const enrichedEvents = events.map((event) => ({
            ...event,
            savingsAmount:
                savingsMap.get(event.eventId) ??
                (event.status === "PROCESSED"
                    ? clampNonNegative(Math.round((event.amount || 0) * safeSavingsPercentage))
                    : 0)
        }));

        return res.json({
            status: "SUCCESS",
            page,
            limit,
            total,
            events: enrichedEvents
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getAdminSavings = async (req, res) => {
    try {
        const operatingMode = resolveAdminViewMode(req);
        const savingsPercentage = Number(process.env.SAVINGS_PERCENTAGE ?? 0.1);
        const safeSavingsPercentage =
            Number.isFinite(savingsPercentage) && savingsPercentage > 0 && savingsPercentage <= 1
                ? savingsPercentage
                : 0.1;

        const eventSavingsPipeline = [
            { $match: { operatingMode } },
            {
                $lookup: {
                    from: "ledgers",
                    let: { eventIdentifier: "$eventId" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$eventId", "$$eventIdentifier"] },
                                        { $eq: ["$account", "USER_SAVINGS"] }
                                    ]
                                }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalSavings: { $sum: "$amount" }
                            }
                        }
                    ],
                    as: "ledgerSavings"
                }
            },
            {
                $addFields: {
                    ledgerSavings: { $ifNull: [{ $arrayElemAt: ["$ledgerSavings.totalSavings", 0] }, null] }
                }
            },
            {
                $addFields: {
                    savingsAmount: {
                        $cond: [
                            { $ne: ["$ledgerSavings", null] },
                            "$ledgerSavings",
                            {
                                $cond: [
                                    { $eq: ["$status", "PROCESSED"] },
                                    { $round: [{ $multiply: [{ $ifNull: ["$amount", 0] }, safeSavingsPercentage] }, 0] },
                                    0
                                ]
                            }
                        ]
                    }
                }
            }
        ];

        const [summary, byPartner, latestLedger] = await Promise.all([
            Event.aggregate([
                { $match: { status: "PROCESSED" } },
                ...eventSavingsPipeline,
                {
                    $group: {
                        _id: null,
                        totalSavings: { $sum: "$savingsAmount" },
                        totalEntries: {
                            $sum: {
                                $cond: [{ $gt: ["$savingsAmount", 0] }, 1, 0]
                            }
                        }
                    }
                }
            ]),
            Event.aggregate([
                { $match: { status: "PROCESSED" } },
                ...eventSavingsPipeline,
                {
                    $group: {
                        _id: "$partnerName",
                        totalSavings: { $sum: "$savingsAmount" },
                        entries: {
                            $sum: {
                                $cond: [{ $gt: ["$savingsAmount", 0] }, 1, 0]
                            }
                        }
                    }
                },
                { $sort: { totalSavings: -1 } }
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
                        "event.status": "PROCESSED",
                        "event.operatingMode": operatingMode
                    }
                },
                { $sort: { createdAt: -1 } },
                { $limit: 50 }
            ])
        ]);

        const safeSummary = summary[0] || { totalSavings: 0, totalEntries: 0 };
        const safeByPartner = byPartner.map((partner) => ({
            ...partner,
            totalSavings: clampNonNegative(partner.totalSavings)
        }));

        return res.json({
            status: "SUCCESS",
            summary: {
                ...safeSummary,
                totalSavings: clampNonNegative(safeSummary.totalSavings)
            },
            byPartner: safeByPartner,
            recentSavingsEntries: latestLedger
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getAdminOperations = async (req, res) => {
    try {
        const operatingMode = resolveAdminViewMode(req);
        const observabilityWindowStart = new Date(Date.now() - (24 * 60 * 60 * 1000));
        const stalePendingBefore = new Date(
            Date.now() - parsePositiveNumber(process.env.STALE_PENDING_PAYMENT_MS, 30 * 60 * 1000)
        );
        const staleSettlementBefore = new Date(
            Date.now() - parsePositiveNumber(process.env.STALE_SETTLEMENT_MS, 24 * 60 * 60 * 1000)
        );
        const staleProcessingBefore = new Date(
            Date.now() - parsePositiveNumber(process.env.STALE_PROCESSING_EVENT_MS, 10 * 60 * 1000)
        );
        const [
            failedEvents,
            suspendedPartners,
            totalPartnerUsers,
            staleProcessingEvents,
            stalePendingDeposits,
            stalePendingWithdrawals,
            successfulUnsettledDeposits,
            settledDepositsLastDay,
            successfulWithdrawalsLastDay,
            failedWithdrawalsLastDay,
            partnerInitiatedWithdrawalsLastDay,
            workerStatuses,
            recentOperationalLogs,
            operationalLogSummary,
            recentReconciliationRuns,
            recentWithdrawals
        ] = await Promise.all([
            Event.countDocuments({ status: "FAILED", operatingMode }),
            Partner.countDocuments({ status: "SUSPENDED" }),
            PartnerUser.countDocuments(),
            Event.countDocuments({ status: "PROCESSING", updatedAt: { $lt: staleProcessingBefore }, operatingMode }),
            PaymentTransaction.find({
                type: "DEPOSIT",
                status: "PENDING",
                updatedAt: { $lt: stalePendingBefore }
            }).select("externalRef").lean(),
            PaymentTransaction.countDocuments({
                type: "WITHDRAWAL",
                status: "PENDING",
                updatedAt: { $lt: stalePendingBefore }
            }),
            PaymentTransaction.find({
                type: "DEPOSIT",
                status: "SUCCESS",
                settlementStatus: "PENDING"
            })
                .select("externalRef amount updatedAt")
                .lean(),
            PaymentTransaction.aggregate([
                {
                    $match: {
                        type: "DEPOSIT",
                        settlementStatus: "SETTLED",
                        settledAt: { $gte: observabilityWindowStart }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: "$amount" },
                        count: { $sum: 1 }
                    }
                }
            ]),
            PaymentTransaction.aggregate([
                {
                    $match: {
                        type: "WITHDRAWAL",
                        status: "SUCCESS",
                        updatedAt: { $gte: observabilityWindowStart }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: "$amount" },
                        count: { $sum: 1 }
                    }
                }
            ]),
            PaymentTransaction.aggregate([
                {
                    $match: {
                        type: "WITHDRAWAL",
                        status: "FAILED",
                        updatedAt: { $gte: observabilityWindowStart }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: "$amount" },
                        count: { $sum: 1 }
                    }
                }
            ]),
            PaymentTransaction.aggregate([
                {
                    $match: {
                        type: "WITHDRAWAL",
                        requestedByType: "PARTNER",
                        createdAt: { $gte: observabilityWindowStart }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: "$amount" },
                        count: { $sum: 1 }
                    }
                }
            ]),
            WorkerStatus.find({})
                .select("workerName status hostname pid lastHeartbeatAt lastSuccessAt lastErrorAt errorMessage metadata")
                .lean(),
            OperationalLog.find({
                $or: [
                    { operatingMode },
                    { operatingMode: null }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(50)
                .lean(),
            OperationalLog.aggregate([
                {
                    $match: {
                        createdAt: { $gte: observabilityWindowStart },
                        $or: [
                            { operatingMode },
                            { operatingMode: null }
                        ]
                    }
                },
                {
                    $group: {
                        _id: "$level",
                        count: { $sum: 1 }
                    }
                }
            ]),
            ReconciliationRun.find({})
                .sort({ createdAt: -1 })
                .limit(10)
                .lean(),
            PaymentTransaction.find({ type: "WITHDRAWAL" })
                .sort({ createdAt: -1 })
                .limit(10)
                .select("status amount phone partnerName requestedByType providerRequestId providerTransactionId failureReason createdAt updatedAt")
                .lean()
        ]);

        const depositScope = stalePendingDeposits.reduce((acc, deposit) => {
            const parsedReference = parseEventReference(deposit.externalRef);
            const mode = String(parsedReference?.operatingMode || "").trim().toLowerCase();

            if (!parsedReference?.eventId || !["demo", "live"].includes(mode)) {
                acc.unscoped += 1;
                return acc;
            }

            if (mode === operatingMode) {
                acc.selectedMode += 1;
            } else {
                acc.otherMode += 1;
            }

            return acc;
        }, {
            selectedMode: 0,
            otherMode: 0,
            unscoped: 0
        });
        const unsettledSettlementScope = successfulUnsettledDeposits.reduce((acc, deposit) => {
            const scope = normalizeSettlementScope(deposit.externalRef);
            const bucket = scope === "demo" || scope === "live" ? scope : "unscoped";
            const amount = Number(deposit.amount || 0);
            const isStale = deposit.updatedAt && new Date(deposit.updatedAt) < staleSettlementBefore;

            acc[bucket].count += 1;
            acc[bucket].amount += amount;
            if (isStale) {
                acc[bucket].staleCount += 1;
                acc[bucket].staleAmount += amount;
            }

            return acc;
        }, {
            demo: { count: 0, amount: 0, staleCount: 0, staleAmount: 0 },
            live: { count: 0, amount: 0, staleCount: 0, staleAmount: 0 },
            unscoped: { count: 0, amount: 0, staleCount: 0, staleAmount: 0 }
        });

        const expectedWorkers = [
            { workerName: "event-worker", label: "Event Worker", expectedWithinMs: (WORKER_HEARTBEAT_INTERVAL_MS * 2) + WORKER_HEALTH_GRACE_MS },
            { workerName: "webhook-worker", label: "Webhook Worker", expectedWithinMs: (WORKER_HEARTBEAT_INTERVAL_MS * 2) + WORKER_HEALTH_GRACE_MS },
            {
                workerName: "recovery-worker",
                label: "Recovery Worker",
                expectedWithinMs: (parsePositiveNumber(process.env.OPERATIONAL_RECOVERY_INTERVAL_MS, 60000) * 2) + WORKER_HEALTH_GRACE_MS
            }
        ];

        const workerStatusByName = new Map(workerStatuses.map((worker) => [worker.workerName, worker]));
        const workers = expectedWorkers.map((workerDefinition) => {
            const worker = workerStatusByName.get(workerDefinition.workerName) || null;
            const lastHeartbeatAt = worker?.lastHeartbeatAt ? new Date(worker.lastHeartbeatAt).getTime() : 0;
            const isHealthy =
                Boolean(worker) &&
                worker.status !== "STOPPED" &&
                worker.status !== "ERROR" &&
                lastHeartbeatAt > 0 &&
                Date.now() - lastHeartbeatAt <= workerDefinition.expectedWithinMs;

            return {
                workerName: workerDefinition.workerName,
                label: workerDefinition.label,
                status: isHealthy ? "HEALTHY" : (worker?.status || "MISSING"),
                isHealthy,
                hostname: worker?.hostname || null,
                pid: worker?.pid || null,
                lastHeartbeatAt: worker?.lastHeartbeatAt || null,
                lastSuccessAt: worker?.lastSuccessAt || null,
                lastErrorAt: worker?.lastErrorAt || null,
                errorMessage: worker?.errorMessage || null,
                metadata: null
            };
        });

        const integrationReadiness = {
            darajaCollectionConfigured: isDarajaCollectionEnabled(),
            darajaDisbursementConfigured: isDarajaDisbursementEnabled(),
            paymentCallbackTokenConfigured: Boolean(process.env.PAYMENT_CALLBACK_TOKEN),
            bankApiUrlConfigured: Boolean(process.env.BANK_API_URL),
            bankApiKeyConfigured: Boolean(process.env.BANK_API_KEY),
            settlementAccountConfigured: Boolean(process.env.BANK_SETTLEMENT_ACCOUNT),
            settlementAutomationConfigured: Boolean(process.env.BANK_API_URL && process.env.BANK_API_KEY)
        };

        return res.json({
            status: "SUCCESS",
            operations: {
                operatingMode,
                generatedAt: new Date().toISOString(),
                scoped: {
                    failedEvents,
                    staleProcessingEvents,
                    stalePendingEventDeposits: depositScope.selectedMode
                },
                global: {
                    suspendedPartners,
                    totalPartnerUsers,
                    stalePendingWithdrawals,
                    stalePendingDepositsOtherMode: depositScope.otherMode,
                    stalePendingDepositsUnscoped: depositScope.unscoped,
                    unsettledSuccessfulDepositsOtherMode: unsettledSettlementScope[operatingMode === "live" ? "demo" : "live"].count,
                    unsettledSuccessfulDepositsUnscoped: unsettledSettlementScope.unscoped.count
                },
                thresholds: {
                    staleProcessingEventMs: parsePositiveNumber(process.env.STALE_PROCESSING_EVENT_MS, 10 * 60 * 1000),
                    stalePendingPaymentMs: parsePositiveNumber(process.env.STALE_PENDING_PAYMENT_MS, 30 * 60 * 1000),
                    staleSettlementMs: parsePositiveNumber(process.env.STALE_SETTLEMENT_MS, 24 * 60 * 60 * 1000)
                },
                settlement: {
                    selectedMode: unsettledSettlementScope[operatingMode],
                    otherMode: unsettledSettlementScope[operatingMode === "live" ? "demo" : "live"],
                    unscoped: unsettledSettlementScope.unscoped,
                    settledLast24Hours: {
                        count: settledDepositsLastDay[0]?.count || 0,
                        totalAmount: clampNonNegative(settledDepositsLastDay[0]?.totalAmount)
                    }
                },
                withdrawals: {
                    stalePendingCount: stalePendingWithdrawals,
                    succeededLast24Hours: {
                        count: successfulWithdrawalsLastDay[0]?.count || 0,
                        totalAmount: clampNonNegative(successfulWithdrawalsLastDay[0]?.totalAmount)
                    },
                    failedLast24Hours: {
                        count: failedWithdrawalsLastDay[0]?.count || 0,
                        totalAmount: clampNonNegative(failedWithdrawalsLastDay[0]?.totalAmount)
                    },
                    partnerInitiatedLast24Hours: {
                        count: partnerInitiatedWithdrawalsLastDay[0]?.count || 0,
                        totalAmount: clampNonNegative(partnerInitiatedWithdrawalsLastDay[0]?.totalAmount)
                    }
                }
            },
            integrationReadiness,
            runtimeReadiness: {
                transactionSupport: supportsTransactions(),
                allWorkersHealthy: workers.every((worker) => worker.isHealthy),
                workers
            },
            observability: {
                summary: {
                    info: operationalLogSummary.find((item) => item._id === "INFO")?.count || 0,
                    warn: operationalLogSummary.find((item) => item._id === "WARN")?.count || 0,
                    error: operationalLogSummary.find((item) => item._id === "ERROR")?.count || 0,
                    windowStartedAt: observabilityWindowStart.toISOString()
                },
                recentOperationalLogs: recentOperationalLogs.map((log) => ({
                    _id: log._id,
                    createdAt: log.createdAt,
                    level: log.level,
                    category: log.category,
                    action: log.action,
                    status: log.status,
                    message: log.message,
                    partnerName: log.partnerName || null,
                    eventId: log.eventId || null,
                    paymentTransactionId: log.paymentTransactionId || null,
                    withdrawalRequestId: log.withdrawalRequestId || null,
                    metadata: sanitizeStructuredData(log.metadata || {})
                })),
                recentReconciliationRuns,
                recentWithdrawals: recentWithdrawals.map((item) => ({
                    ...item,
                    phone: maskPhoneForDisplay(item.phone)
                }))
            },
            roadmap: {
                nextMilestones: [
                    "Automate provider-side settlement ingestion from your bank or finance export feed",
                    "Add alert routing for stale pending deposits and withdrawals",
                    "Run periodic disaster recovery drills against Daraja callback delay and replay scenarios"
                ]
            }
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const runAdminSettlementReconciliation = async (req, res) => {
    try {
        const settlements = Array.isArray(req.body?.settlements) ? req.body.settlements : [];
        if (!settlements.length) {
            return res.status(400).json({
                status: "FAILED",
                reason: "settlements must be a non-empty array"
            });
        }

        const result = await runPaybillSettlementReconciliation({
            settlements,
            runDate: req.body?.runDate || new Date(),
            source: req.body?.source || "SAFARICOM_PAYBILL",
            batchReference: req.body?.batchReference || null,
            settlementAccount: req.body?.settlementAccount || process.env.BANK_SETTLEMENT_ACCOUNT || null
        });

        await logAdminDecision(req, {
            action: "SETTLEMENT_RECONCILIATION_RUN",
            title: "Settlement Reconciliation Completed",
            message: `Settlement reconciliation run ${result.run._id} completed with status ${result.run.status}.`,
            targetType: "RECONCILIATION_RUN",
            targetId: String(result.run._id),
            metadata: {
                status: result.run.status,
                source: result.run.source,
                batchReference: result.run.batchReference,
                settledTransactions: result.run.settledTransactions,
                duplicateTransactions: result.run.duplicateTransactions,
                unmatchedTransactions: result.run.unmatchedTransactions,
                discrepancies: result.run.discrepancies?.length || 0
            }
        });

        return res.status(201).json({
            status: "SUCCESS",
            reconciliationRun: result.run,
            stats: result.stats
        });
    } catch (error) {
        return res.status(400).json({
            status: "FAILED",
            reason: error.message
        });
    }
};
