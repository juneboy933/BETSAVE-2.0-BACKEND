import Event from "../database/models/event.model.js";
import PaymentTransaction from "../database/models/paymentTransaction.model.js";
import WithdrawalRequest from "../database/models/withdrawalRequest.model.js";
import { finalizeEvent } from "./eventFinalization.service.js";
import { buildEventExternalRef, parseEventReference } from "./eventReference.service.js";
import { failDeposit } from "./paymentCollection.service.js";
import { markWithdrawalFailed } from "./paymentWithdrawal.service.js";
import { recordOperationalLogSafe } from "./operationalLog.service.js";

const parsePositiveNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const RECOVERY_BATCH_SIZE = () => parsePositiveNumber(process.env.RECOVERY_BATCH_SIZE, 100);
const STALE_PROCESSING_EVENT_MS = () => parsePositiveNumber(process.env.STALE_PROCESSING_EVENT_MS, 10 * 60 * 1000);
const STALE_INITIATED_PAYMENT_MS = () => parsePositiveNumber(process.env.STALE_INITIATED_PAYMENT_MS, 5 * 60 * 1000);
const STALE_PENDING_PAYMENT_MS = () => parsePositiveNumber(process.env.STALE_PENDING_PAYMENT_MS, 30 * 60 * 1000);
const STALE_SETTLEMENT_MS = () => parsePositiveNumber(process.env.STALE_SETTLEMENT_MS, 24 * 60 * 60 * 1000);

const resolveLinkedDepositTransaction = async (event) => {
    if (event.paymentTransactionId) {
        return PaymentTransaction.findById(event.paymentTransactionId);
    }

    return PaymentTransaction.findOne({
        type: "DEPOSIT",
        userId: event.userId,
        externalRef: buildEventExternalRef({
            partnerName: event.partnerName,
            operatingMode: event.operatingMode || "demo",
            eventId: event.eventId
        })
    }).sort({ createdAt: -1 });
};

const recoverStaleProcessingEvents = async (now) => {
    const staleBefore = new Date(now - STALE_PROCESSING_EVENT_MS());
    const staleEvents = await Event.find({
        status: "PROCESSING",
        updatedAt: { $lt: staleBefore }
    })
        .sort({ updatedAt: 1 })
        .limit(RECOVERY_BATCH_SIZE());

    const stats = {
        inspected: staleEvents.length,
        finalizedProcessed: 0,
        finalizedFailed: 0,
        unresolvedPending: 0,
        missingTransactions: 0
    };

    for (const event of staleEvents) {
        const paymentTransaction = await resolveLinkedDepositTransaction(event);

        if (!paymentTransaction) {
            stats.missingTransactions += 1;
            continue;
        }

        if (paymentTransaction.status === "SUCCESS") {
            await finalizeEvent({
                event,
                paymentTransaction,
                nextStatus: "PROCESSED",
                notifyPartner: true
            });
            stats.finalizedProcessed += 1;
            continue;
        }

        if (paymentTransaction.status === "FAILED") {
            await finalizeEvent({
                event,
                paymentTransaction,
                nextStatus: "FAILED",
                failureReason: paymentTransaction.failureReason,
                notifyPartner: true
            });
            stats.finalizedFailed += 1;
            continue;
        }

        stats.unresolvedPending += 1;
    }

    return stats;
};

const failStaleInitiatedDeposits = async (now) => {
    const staleBefore = new Date(now - STALE_INITIATED_PAYMENT_MS());
    const deposits = await PaymentTransaction.find({
        type: "DEPOSIT",
        status: "INITIATED",
        createdAt: { $lt: staleBefore }
    })
        .sort({ createdAt: 1 })
        .limit(RECOVERY_BATCH_SIZE());

    let failed = 0;
    for (const deposit of deposits) {
        const eventRef = parseEventReference(deposit.externalRef);
        const failedDeposit = await failDeposit({
            paymentTransactionId: deposit._id,
            failureReason:
                eventRef?.operatingMode === "demo"
                    ? "Recovery marked stale initiated demo deposit as failed before STK acknowledgement"
                    : "Recovery marked stale initiated deposit as failed"
        });

        if (String(failedDeposit.channel || "").toUpperCase() === "STK") {
            await finalizeEvent({
                paymentTransaction: failedDeposit,
                nextStatus: "FAILED",
                failureReason: failedDeposit.failureReason,
                notifyPartner: true
            });
        }
        failed += 1;
    }

    return failed;
};

const failStaleInitiatedWithdrawals = async (now) => {
    const staleBefore = new Date(now - STALE_INITIATED_PAYMENT_MS());
    const payments = await PaymentTransaction.find({
        type: "WITHDRAWAL",
        status: "INITIATED",
        createdAt: { $lt: staleBefore }
    })
        .sort({ createdAt: 1 })
        .limit(RECOVERY_BATCH_SIZE());

    let failed = 0;
    for (const payment of payments) {
        const withdrawalRequest = await WithdrawalRequest.findOne({
            paymentTransactionId: payment._id
        }).select("_id");

        if (!withdrawalRequest?._id) {
            continue;
        }

        await markWithdrawalFailed({
            withdrawalRequestId: withdrawalRequest._id,
            failureReason: "Recovery marked stale initiated withdrawal as failed"
        });
        failed += 1;
    }

    return failed;
};

const getStalePendingCounts = async (now) => {
    const staleBefore = new Date(now - STALE_PENDING_PAYMENT_MS());
    const staleSettlementBefore = new Date(now - STALE_SETTLEMENT_MS());

    const [
        stalePendingDeposits,
        stalePendingWithdrawals,
        staleProcessingEvents,
        staleUnsettledDeposits
    ] = await Promise.all([
        PaymentTransaction.countDocuments({
            type: "DEPOSIT",
            status: "PENDING",
            updatedAt: { $lt: staleBefore }
        }),
        PaymentTransaction.countDocuments({
            type: "WITHDRAWAL",
            status: "PENDING",
            updatedAt: { $lt: staleBefore }
        }),
        Event.countDocuments({
            status: "PROCESSING",
            updatedAt: { $lt: staleBefore }
        }),
        PaymentTransaction.countDocuments({
            type: "DEPOSIT",
            status: "SUCCESS",
            settlementStatus: "PENDING",
            updatedAt: { $lt: staleSettlementBefore }
        })
    ]);

    return {
        stalePendingDeposits,
        stalePendingWithdrawals,
        staleProcessingEvents,
        staleUnsettledDeposits
    };
};

export const runOperationalRecovery = async () => {
    const now = Date.now();
    const failedInitiatedDeposits = await failStaleInitiatedDeposits(now);
    const failedInitiatedWithdrawals = await failStaleInitiatedWithdrawals(now);
    const eventRecovery = await recoverStaleProcessingEvents(now);
    const stalePending = await getStalePendingCounts(now);
    const result = {
        eventRecovery,
        failedInitiatedDeposits,
        failedInitiatedWithdrawals,
        ...stalePending
    };

    await recordOperationalLogSafe({
        category: "RECOVERY",
        action: "RECOVERY_CYCLE_COMPLETED",
        level:
            failedInitiatedDeposits > 0 ||
            failedInitiatedWithdrawals > 0 ||
            stalePending.stalePendingDeposits > 0 ||
            stalePending.stalePendingWithdrawals > 0 ||
            stalePending.staleUnsettledDeposits > 0 ||
            stalePending.staleProcessingEvents > 0 ||
            eventRecovery.finalizedFailed > 0
                ? "WARN"
                : "INFO",
        status: "COMPLETED",
        message: "Operational recovery cycle completed",
        targetType: "RECOVERY_CYCLE",
        targetId: new Date(now).toISOString(),
        metadata: result
    });

    return result;
};
