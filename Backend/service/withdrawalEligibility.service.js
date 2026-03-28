import mongoose from "mongoose";

import PartnerUser from "../database/models/partnerUser.model.js";
import Partner from "../database/models/partner.model.js";
import PaymentTransaction from "../database/models/paymentTransaction.model.js";
import Wallet from "../database/models/wallet.model.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_LINK_STATUSES = ["VERIFIED", "ACTIVE"];

const parsePositiveNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizeDate = (value) => {
    const date = value ? new Date(value) : null;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
};

export const getLiveWithdrawalMinBalanceKes = () =>
    parsePositiveNumber(process.env.LIVE_WITHDRAWAL_MIN_BALANCE_KES, 100);

export const getLiveWithdrawalMinAutoSavingsDays = () =>
    Math.max(1, Math.round(parsePositiveNumber(process.env.LIVE_WITHDRAWAL_MIN_AUTOSAVINGS_DAYS, 90)));

export const evaluateWithdrawalEligibilitySnapshot = ({
    currentBalance,
    hasLiveWalletActivity,
    liveAutoSavingsLinks,
    now = new Date(),
    liveMinBalanceKes = getLiveWithdrawalMinBalanceKes(),
    minAutoSavingsDays = getLiveWithdrawalMinAutoSavingsDays()
}) => {
    const normalizedNow = normalizeDate(now) || new Date();
    const normalizedBalance = Math.max(0, Number(currentBalance) || 0);
    const normalizedLinks = Array.isArray(liveAutoSavingsLinks)
        ? liveAutoSavingsLinks
            .map((link) => {
                const enabledAt = normalizeDate(
                    link?.autoSavingsEnabledAt || link?.updatedAt || link?.createdAt
                );
                if (!enabledAt) {
                    return null;
                }

                return {
                    partnerId: link.partnerId || null,
                    partnerName: String(link.partnerName || "").trim() || null,
                    status: String(link.status || "").trim().toUpperCase() || null,
                    autoSavingsEnabledAt: enabledAt
                };
            })
            .filter(Boolean)
        : [];

    const operatingMode = hasLiveWalletActivity || normalizedLinks.length ? "live" : "demo";
    const maturityCutoff = new Date(normalizedNow.getTime() - (minAutoSavingsDays * DAY_MS));
    const matureLinks = normalizedLinks.filter((link) => link.autoSavingsEnabledAt <= maturityCutoff);
    const earliestEnabledAt = normalizedLinks
        .map((link) => link.autoSavingsEnabledAt)
        .sort((left, right) => left.getTime() - right.getTime())[0] || null;
    const firstEligibleAt = earliestEnabledAt
        ? new Date(earliestEnabledAt.getTime() + (minAutoSavingsDays * DAY_MS))
        : null;

    let denialReason = null;
    if (operatingMode === "live") {
        if (normalizedBalance < liveMinBalanceKes) {
            denialReason = `Live withdrawals require a wallet balance of at least KES ${liveMinBalanceKes}`;
        } else if (!normalizedLinks.length) {
            denialReason = "Live withdrawals require auto-savings to be enabled with an active live partner";
        } else if (!matureLinks.length) {
            denialReason = `Live withdrawals are available after ${minAutoSavingsDays} days of active live auto-savings`;
        }
    }

    return {
        operatingMode,
        eligible: !denialReason,
        denialReason,
        currentBalance: normalizedBalance,
        hasLiveWalletActivity: Boolean(hasLiveWalletActivity),
        liveMinBalanceKes,
        minAutoSavingsDays,
        liveAutoSavingsLinkCount: normalizedLinks.length,
        matureLiveAutoSavingsLinkCount: matureLinks.length,
        earliestAutoSavingsEnabledAt: earliestEnabledAt,
        firstEligibleAt
    };
};

export const resolveWithdrawalEligibility = async ({
    userId,
    walletModel = Wallet,
    paymentTransactionModel = PaymentTransaction,
    partnerUserModel = PartnerUser,
    partnerModel = Partner,
    now = new Date()
}) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error("Invalid user id");
    }

    const objectUserId = new mongoose.Types.ObjectId(userId);
    const [wallet, hasLiveWalletActivity, liveAutoSavingsLinks] = await Promise.all([
        walletModel.findOne({ userId: objectUserId }).select("balance").lean(),
        paymentTransactionModel.exists({
            userId: objectUserId,
            type: "DEPOSIT",
            status: "SUCCESS",
            settlementStatus: { $ne: "NOT_APPLICABLE" }
        }),
        partnerUserModel.aggregate([
            {
                $match: {
                    userId: objectUserId,
                    autoSavingsEnabled: true,
                    status: { $in: LIVE_LINK_STATUSES }
                }
            },
            {
                $lookup: {
                    from: partnerModel.collection.name,
                    localField: "partnerId",
                    foreignField: "_id",
                    as: "partner"
                }
            },
            {
                $unwind: "$partner"
            },
            {
                $match: {
                    "partner.status": "ACTIVE",
                    "partner.operatingMode": "live"
                }
            },
            {
                $project: {
                    _id: 0,
                    partnerId: 1,
                    partnerName: 1,
                    status: 1,
                    autoSavingsEnabledAt: 1,
                    createdAt: 1,
                    updatedAt: 1
                }
            }
        ])
    ]);

    return evaluateWithdrawalEligibilitySnapshot({
        currentBalance: wallet?.balance || 0,
        hasLiveWalletActivity: Boolean(hasLiveWalletActivity),
        liveAutoSavingsLinks,
        now
    });
};
