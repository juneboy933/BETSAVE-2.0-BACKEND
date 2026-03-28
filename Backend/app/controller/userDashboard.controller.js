import mongoose from "mongoose";
import Event from "../../database/models/event.model.js";
import Ledger from "../../database/models/ledger.model.js";
import User from "../../database/models/user.model.js";
import Wallet from "../../database/models/wallet.model.js";

const parsePagination = (query) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    return { page, limit };
};

const normalizeOperatingMode = (value) => {
    const mode = String(value || "").trim().toLowerCase();
    if (mode === "live") return "live";
    if (mode === "demo") return "demo";
    return null;
};

const parseEventReference = (reference) => {
    const raw = String(reference || "").trim();
    if (!raw.startsWith("EVENT::")) {
        return null;
    }

    const parts = raw.split("::");
    if (parts.length >= 4) {
        const partnerName = String(parts[1] || "").trim();
        const operatingMode = normalizeOperatingMode(parts[2]);
        const eventId = String(parts.slice(3).join("::") || "").trim();
        if (partnerName && eventId) {
            return { partnerName, operatingMode: operatingMode || "live", eventId };
        }
    }

    if (parts.length >= 3) {
        const partnerName = String(parts[1] || "").trim();
        const eventId = String(parts.slice(2).join("::") || "").trim();
        if (partnerName && eventId) {
            return { partnerName, operatingMode: "live", eventId };
        }
    }

    return null;
};

const toNonNegative = (value) => Math.max(0, Number(value) || 0);

export const getUserDashboardSummary = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid user id"
            });
        }

        const objectUserId = new mongoose.Types.ObjectId(userId);

        const [user, wallet, eventStats, legacySavingsStats, recentEvents, recentTransactions, walletAttributionEntries] = await Promise.all([
            User.findById(objectUserId).select("phoneNumber status verified createdAt").lean(),
            Wallet.findOne({ userId: objectUserId }).select("balance updatedAt").lean(),
            Event.aggregate([
                { $match: { userId: objectUserId } },
                {
                    $group: {
                        _id: "$status",
                        count: { $sum: 1 },
                        totalAmount: { $sum: "$amount" }
                    }
                }
            ]),
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
            Event.find({ userId: objectUserId })
                .sort({ createdAt: -1 })
                .limit(5)
                .lean(),
            Ledger.find({ userId: objectUserId, account: "USER_WALLET_LIABILITY", reference: /^EVENT::/ })
                .sort({ createdAt: -1 })
                .limit(5)
                .select("eventId amount reference createdAt")
                .lean(),
            Ledger.find({ userId: objectUserId, account: "USER_WALLET_LIABILITY", reference: /^EVENT::/ })
                .select("amount reference createdAt")
                .lean()
        ]);

        if (!user) {
            return res.status(404).json({
                status: "FAILED",
                reason: "User not found"
            });
        }

        const savingsByPlatformMap = new Map();
        walletAttributionEntries.forEach((entry) => {
            const parsed = parseEventReference(entry.reference);
            if (!parsed?.partnerName) return;

            const key = parsed.partnerName;
            const current = savingsByPlatformMap.get(key) || {
                partnerName: key,
                totalSaved: 0,
                entries: 0,
                byMode: {
                    live: 0,
                    demo: 0
                }
            };

            const amount = Number(entry.amount || 0);
            current.totalSaved += amount;
            current.entries += 1;
            current.byMode[parsed.operatingMode === "demo" ? "demo" : "live"] += amount;
            savingsByPlatformMap.set(key, current);
        });

        const byPlatform = [...savingsByPlatformMap.values()]
            .map((row) => ({
                ...row,
                totalSaved: toNonNegative(row.totalSaved),
                byMode: {
                    live: toNonNegative(row.byMode.live),
                    demo: toNonNegative(row.byMode.demo)
                }
            }))
            .sort((a, b) => b.totalSaved - a.totalSaved);

        const cumulativeTotalSaved = byPlatform.reduce((sum, row) => sum + row.totalSaved, 0);
        const legacySavings = legacySavingsStats[0] || { totalSaved: 0, entries: 0 };
        const totalSaved = cumulativeTotalSaved || toNonNegative(legacySavings.totalSaved);
        const totalEntries = byPlatform.reduce((sum, row) => sum + (Number(row.entries) || 0), 0) || Number(legacySavings.entries || 0);

        const requestedPartnerName = String(req.query.partnerName || "").trim();
        const currentPlatform = requestedPartnerName
            ? byPlatform.find((row) => row.partnerName === requestedPartnerName) || {
                partnerName: requestedPartnerName,
                totalSaved: 0,
                entries: 0,
                byMode: { live: 0, demo: 0 }
            }
            : null;

        return res.json({
            status: "SUCCESS",
            user,
            wallet: wallet || { balance: 0 },
            eventStats,
            savings: {
                totalSaved: toNonNegative(totalSaved),
                entries: totalEntries,
                cumulativeTotalSaved: toNonNegative(cumulativeTotalSaved),
                byPlatform,
                currentPlatform
            },
            recentEvents,
            recentTransactions,
            partnerAttributedWalletBalance: toNonNegative(currentPlatform?.totalSaved)
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getUserEvents = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid user id"
            });
        }

        const { page, limit } = parsePagination(req.query);
        const query = { userId: new mongoose.Types.ObjectId(userId) };
        if (req.query.status) query.status = req.query.status;

        const [events, total] = await Promise.all([
            Event.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Event.countDocuments(query)
        ]);

        return res.json({
            status: "SUCCESS",
            page,
            limit,
            total,
            events
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getUserTransactions = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid user id"
            });
        }

        const { page, limit } = parsePagination(req.query);
        const query = {
            userId: new mongoose.Types.ObjectId(userId),
            account: "USER_WALLET_LIABILITY",
            reference: /^EVENT::/
        };

        const [transactions, total] = await Promise.all([
            Ledger.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Ledger.countDocuments(query)
        ]);

        return res.json({
            status: "SUCCESS",
            page,
            limit,
            total,
            transactions
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};
