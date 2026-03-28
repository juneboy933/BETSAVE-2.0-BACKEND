import PaymentTransaction from "../database/models/paymentTransaction.model.js";
import ReconciliationRun from "../database/models/reconciliationRun.model.js";
import { postLedger } from "./postLedger.service.js";
import { runRequiredTransaction } from "./databaseSession.service.js";
import { parseEventReference } from "./eventReference.service.js";
import { recordOperationalLogSafe } from "./operationalLog.service.js";

const parsePositiveNumber = (value, fallback = null) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizeString = (value) => {
    const normalized = String(value || "").trim();
    return normalized || null;
};

const normalizeDate = (value) => {
    const date = value ? new Date(value) : null;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
};

const normalizeSettlementMode = (externalRef) => {
    const mode = String(parseEventReference(externalRef)?.operatingMode || "").trim().toLowerCase();
    if (mode === "demo") return "demo";
    return "live";
};

const buildSettlementEventId = (paymentTransactionId) => `PAYMENT_${paymentTransactionId}_SETTLEMENT`;

export const deriveDepositSettlementStatus = ({ externalRef = null, applyWalletCredit = true } = {}) => {
    if (!applyWalletCredit) {
        return "NOT_APPLICABLE";
    }

    return normalizeSettlementMode(externalRef) === "demo"
        ? "NOT_APPLICABLE"
        : "PENDING";
};

export const normalizeSettlementEntry = (entry = {}, index = 0) => {
    const amount = parsePositiveNumber(entry.amount);
    const providerTransactionId = normalizeString(entry.providerTransactionId);
    const providerRequestId = normalizeString(entry.providerRequestId);
    const externalRef = normalizeString(entry.externalRef);
    const settlementReference = normalizeString(
        entry.settlementReference || entry.bankReference || entry.reference
    );
    const settlementBatchKey = normalizeString(entry.settlementBatchKey || entry.batchKey);
    const settledAt = normalizeDate(entry.settledAt || entry.settlementDate || entry.valueDate);

    if (!amount) {
        throw new Error(`Settlement entry ${index + 1} amount is invalid`);
    }
    if (!providerTransactionId && !providerRequestId && !externalRef) {
        throw new Error(
            `Settlement entry ${index + 1} must include providerTransactionId, providerRequestId, or externalRef`
        );
    }

    return {
        amount,
        providerTransactionId,
        providerRequestId,
        externalRef,
        settlementReference,
        settlementBatchKey,
        settledAt,
        metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {}
    };
};

export const classifySettlementCandidate = ({ paymentTransaction, settlementEntry }) => {
    if (!paymentTransaction) {
        return {
            outcome: "UNMATCHED",
            discrepancy: {
                key:
                    settlementEntry.providerTransactionId ||
                    settlementEntry.providerRequestId ||
                    settlementEntry.externalRef ||
                    "UNKNOWN",
                expectedAmount: 0,
                providerAmount: settlementEntry.amount,
                variance: settlementEntry.amount,
                notes: "No successful deposit matched this settlement entry"
            }
        };
    }

    const paymentAmount = Number(paymentTransaction.amount || 0);
    if (paymentTransaction.type !== "DEPOSIT") {
        return {
            outcome: "INVALID_STATE",
            discrepancy: {
                key: String(paymentTransaction._id),
                expectedAmount: paymentAmount,
                providerAmount: settlementEntry.amount,
                variance: settlementEntry.amount - paymentAmount,
                notes: "Matched transaction is not a deposit"
            }
        };
    }
    if (paymentTransaction.status !== "SUCCESS") {
        return {
            outcome: "INVALID_STATE",
            discrepancy: {
                key: String(paymentTransaction._id),
                expectedAmount: paymentAmount,
                providerAmount: settlementEntry.amount,
                variance: settlementEntry.amount - paymentAmount,
                notes: `Matched deposit is ${paymentTransaction.status}, not SUCCESS`
            }
        };
    }
    const derivedSettlementStatus = deriveDepositSettlementStatus({
        externalRef: paymentTransaction.externalRef,
        applyWalletCredit: true
    });
    if (paymentTransaction.settlementStatus === "NOT_APPLICABLE" || derivedSettlementStatus === "NOT_APPLICABLE") {
        return {
            outcome: "INVALID_STATE",
            discrepancy: {
                key: String(paymentTransaction._id),
                expectedAmount: paymentAmount,
                providerAmount: settlementEntry.amount,
                variance: settlementEntry.amount - paymentAmount,
                notes: "Matched deposit is demo or otherwise not settlement-eligible"
            }
        };
    }
    if (paymentAmount !== settlementEntry.amount) {
        return {
            outcome: "AMOUNT_MISMATCH",
            discrepancy: {
                key: String(paymentTransaction._id),
                expectedAmount: paymentAmount,
                providerAmount: settlementEntry.amount,
                variance: settlementEntry.amount - paymentAmount,
                notes: "Settlement amount does not match successful deposit amount"
            }
        };
    }
    if (
        paymentTransaction.settlementStatus === "SETTLED" &&
        paymentTransaction.settlementReference &&
        settlementEntry.settlementReference &&
        paymentTransaction.settlementReference !== settlementEntry.settlementReference
    ) {
        return {
            outcome: "REFERENCE_MISMATCH",
            discrepancy: {
                key: String(paymentTransaction._id),
                expectedAmount: paymentAmount,
                providerAmount: settlementEntry.amount,
                variance: 0,
                notes: "Deposit is already settled with a different settlement reference"
            }
        };
    }
    if (paymentTransaction.settlementStatus === "SETTLED") {
        return {
            outcome: "DUPLICATE",
            discrepancy: null
        };
    }

    return {
        outcome: "MATCHED",
        discrepancy: null
    };
};

const buildSettlementLookupQuery = (settlementEntry) => {
    const orConditions = [
        settlementEntry.providerTransactionId ? { providerTransactionId: settlementEntry.providerTransactionId } : null,
        settlementEntry.providerRequestId ? { providerRequestId: settlementEntry.providerRequestId } : null,
        settlementEntry.externalRef ? { externalRef: settlementEntry.externalRef } : null
    ].filter(Boolean);

    if (!orConditions.length) {
        throw new Error("Settlement entry cannot be matched without identifiers");
    }

    return {
        type: "DEPOSIT",
        $or: orConditions
    };
};

const settleDepositTransaction = async ({ paymentTransaction, settlementEntry, source, settlementAccount, session }) => {
    const settlementEventId = buildSettlementEventId(paymentTransaction._id);
    const settlementReference =
        settlementEntry.settlementReference ||
        settlementEntry.providerTransactionId ||
        settlementEntry.providerRequestId ||
        `settlement_${paymentTransaction._id}`;

    await postLedger({
        userId: paymentTransaction.userId,
        eventId: settlementEventId,
        reference: settlementReference,
        entries: [
            {
                eventId: settlementEventId,
                account: "MPESA_COLLECTION",
                amount: Number(paymentTransaction.amount)
            },
            {
                eventId: settlementEventId,
                account: "BANK_SETTLEMENT",
                amount: -Number(paymentTransaction.amount),
                reference: settlementReference
            }
        ],
        walletDelta: 0,
        idempotencyQuery: {
            eventId: settlementEventId,
            userId: paymentTransaction.userId,
            account: "BANK_SETTLEMENT"
        },
        checkpointAccount: "BANK_SETTLEMENT",
        session
    });

    paymentTransaction.settlementStatus = "SETTLED";
    paymentTransaction.settlementReference = settlementReference;
    paymentTransaction.settlementBatchKey =
        settlementEntry.settlementBatchKey || paymentTransaction.settlementBatchKey;
    paymentTransaction.settledAt = settlementEntry.settledAt || paymentTransaction.settledAt || new Date();
    paymentTransaction.settlementFailureReason = null;
    paymentTransaction.settlementMetadata = {
        ...(paymentTransaction.settlementMetadata || {}),
        ...settlementEntry.metadata,
        source,
        settlementAccount: settlementAccount || null
    };
    await paymentTransaction.save({ session });

    return {
        category: "SETTLEMENT",
        action: "PAYBILL_DEPOSIT_SETTLED",
        level: "INFO",
        status: "SETTLED",
        message: `Settled deposit ${paymentTransaction._id} into bank settlement ledger`,
        targetType: "PAYMENT_TRANSACTION",
        targetId: String(paymentTransaction._id),
        userId: paymentTransaction.userId,
        paymentTransactionId: paymentTransaction._id,
        externalRef: paymentTransaction.externalRef,
        operatingMode: normalizeSettlementMode(paymentTransaction.externalRef),
        metadata: {
            amount: paymentTransaction.amount,
            settlementReference,
            settlementBatchKey: paymentTransaction.settlementBatchKey,
            settlementAccount: settlementAccount || null,
            source
        }
    };
};

export const runPaybillSettlementReconciliation = async ({
    settlements,
    runDate = new Date(),
    source = "SAFARICOM_PAYBILL",
    batchReference = null,
    settlementAccount = process.env.BANK_SETTLEMENT_ACCOUNT || null
} = {}) => {
    if (!Array.isArray(settlements) || settlements.length === 0) {
        throw new Error("settlements must be a non-empty array");
    }

    const normalizedEntries = settlements.map((entry, index) => normalizeSettlementEntry(entry, index));
    const normalizedRunDate = normalizeDate(runDate) || new Date();
    const safeBatchReference = normalizeString(batchReference);
    const providerTotal = normalizedEntries.reduce((sum, entry) => sum + entry.amount, 0);
    const discrepancies = [];

    const summary = await runRequiredTransaction(async (session) => {
        const stats = {
            matched: 0,
            settled: 0,
            duplicates: 0,
            unmatched: 0,
            invalid: 0,
            expectedTotal: 0
        };
        const settlementLogs = [];

        for (const settlementEntry of normalizedEntries) {
            let paymentTransactionQuery = PaymentTransaction.findOne(buildSettlementLookupQuery(settlementEntry))
                .sort({ createdAt: -1 });
            if (session) {
                paymentTransactionQuery = paymentTransactionQuery.session(session);
            }
            const paymentTransaction = await paymentTransactionQuery;
            const classification = classifySettlementCandidate({ paymentTransaction, settlementEntry });

            if (classification.discrepancy) {
                discrepancies.push(classification.discrepancy);
            }

            if (paymentTransaction?._id) {
                stats.expectedTotal += Number(paymentTransaction.amount || 0);
            }

            if (classification.outcome === "MATCHED") {
                stats.matched += 1;
                const settlementLog = await settleDepositTransaction({
                    paymentTransaction,
                    settlementEntry,
                    source,
                    settlementAccount,
                    session
                });
                settlementLogs.push(settlementLog);
                stats.settled += 1;
                continue;
            }

            if (classification.outcome === "DUPLICATE") {
                stats.duplicates += 1;
                continue;
            }

            if (classification.outcome === "UNMATCHED") {
                stats.unmatched += 1;
                continue;
            }

            stats.invalid += 1;

            if (paymentTransaction?._id && paymentTransaction.settlementStatus !== "SETTLED") {
                paymentTransaction.settlementStatus = "EXCEPTION";
                paymentTransaction.settlementFailureReason = classification.discrepancy?.notes || "Settlement mismatch";
                paymentTransaction.settlementMetadata = {
                    ...(paymentTransaction.settlementMetadata || {}),
                    lastSettlementMismatch: settlementEntry
                };
                await paymentTransaction.save({ session });
            }
        }

        const variance = providerTotal - stats.expectedTotal;
        const [reconciliationRun] = await ReconciliationRun.create([{
            runDate: normalizedRunDate,
            status: discrepancies.length ? "FAILED" : "COMPLETED",
            expectedTotal: stats.expectedTotal,
            providerTotal,
            variance,
            discrepancies,
            source,
            batchReference: safeBatchReference,
            settlementAccount: normalizeString(settlementAccount),
            matchedTransactions: stats.matched,
            settledTransactions: stats.settled,
            duplicateTransactions: stats.duplicates,
            unmatchedTransactions: stats.unmatched,
            metadata: {
                invalidTransactions: stats.invalid
            }
        }], session ? { session } : undefined);

        return {
            run: reconciliationRun,
            stats,
            settlementLogs
        };
    }, { label: "paybill-settlement-reconciliation" });

    for (const logPayload of summary.settlementLogs) {
        await recordOperationalLogSafe(logPayload);
    }

    await recordOperationalLogSafe({
        category: "SETTLEMENT",
        action: "PAYBILL_RECONCILIATION_COMPLETED",
        level: summary.run.status === "COMPLETED" ? "INFO" : "WARN",
        status: summary.run.status,
        message: `Completed paybill settlement reconciliation run ${summary.run._id}`,
        targetType: "RECONCILIATION_RUN",
        targetId: String(summary.run._id),
        metadata: {
            source,
            batchReference: safeBatchReference,
            settlementAccount: settlementAccount || null,
            expectedTotal: summary.stats.expectedTotal,
            providerTotal,
            discrepancyCount: discrepancies.length,
            ...summary.stats
        }
    });

    return summary;
};
