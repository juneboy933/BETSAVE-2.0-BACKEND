import PaymentTransaction from "../database/models/paymentTransaction.model.js";
import { postLedger } from "./postLedger.service.js";
import { runRequiredTransaction } from "./databaseSession.service.js";
import { deriveDepositSettlementStatus } from "./paymentSettlement.service.js";

const normalizePhone = (phone) => String(phone || "").trim();
const KENYA_PHONE_REGEX = /^\+254\d{9}$/;

const validateAmount = (amount) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Invalid amount");
    }
    return value;
};

const buildPaymentEventId = (paymentTransactionId) => `PAYMENT_${paymentTransactionId}`;

export const initiateDeposit = async ({ userId, phone, amount, channel = "STK", idempotencyKey, externalRef = null }) => {
    if (!idempotencyKey) {
        throw new Error("idempotencyKey is required");
    }

    const normalizedPhone = normalizePhone(phone);
    if (!KENYA_PHONE_REGEX.test(normalizedPhone)) {
        throw new Error("Invalid phone number format. Use +254XXXXXXXXX");
    }

    const depositAmount = validateAmount(amount);

    const existing = await PaymentTransaction.findOne({ idempotencyKey });
    if (existing) {
        return existing;
    }

    const paymentTransaction = await PaymentTransaction.create({
        type: "DEPOSIT",
        channel,
        status: "INITIATED",
        userId,
        phone: normalizedPhone,
        amount: depositAmount,
        currency: "KES",
        externalRef,
        idempotencyKey
    });

    return paymentTransaction;
};

export const confirmDeposit = async ({
    paymentTransactionId,
    providerRequestId = null,
    providerTransactionId = null,
    externalRef = null,
    rawCallback = null,
    applyWalletCredit = true,
    recordLiabilityLedger = true
}) => {
    return runRequiredTransaction(async (session) => {
        let paymentTransactionQuery = PaymentTransaction.findById(paymentTransactionId);
        if (session) {
            paymentTransactionQuery = paymentTransactionQuery.session(session);
        }
        const paymentTransaction = await paymentTransactionQuery;

        if (!paymentTransaction) {
            throw new Error("Payment transaction not found");
        }

        if (paymentTransaction.type !== "DEPOSIT") {
            throw new Error("Invalid payment transaction type");
        }

        if (paymentTransaction.status === "SUCCESS") {
            return paymentTransaction;
        }

        if (recordLiabilityLedger) {
            const amount = validateAmount(paymentTransaction.amount);
            const eventId = buildPaymentEventId(paymentTransaction._id);

            await postLedger({
                userId: paymentTransaction.userId,
                eventId,
                reference: externalRef || paymentTransaction.externalRef || `deposit_${paymentTransaction._id}`,
                entries: [
                    {
                        eventId,
                        account: "MPESA_COLLECTION",
                        amount: -amount
                    },
                    {
                        eventId,
                        account: "USER_WALLET_LIABILITY",
                        amount: amount
                    }
                ],
                walletDelta: applyWalletCredit ? amount : 0,
                idempotencyQuery: {
                    eventId,
                    userId: paymentTransaction.userId,
                    account: "USER_WALLET_LIABILITY"
                },
                checkpointAccount: "USER_WALLET_LIABILITY",
                session
            });
        }

        paymentTransaction.status = "SUCCESS";
        paymentTransaction.providerRequestId = providerRequestId || paymentTransaction.providerRequestId;
        paymentTransaction.providerTransactionId = providerTransactionId || paymentTransaction.providerTransactionId;
        paymentTransaction.externalRef = externalRef || paymentTransaction.externalRef;
        paymentTransaction.rawCallback = rawCallback || paymentTransaction.rawCallback;
        paymentTransaction.settlementStatus = deriveDepositSettlementStatus({
            externalRef: paymentTransaction.externalRef,
            applyWalletCredit
        });
        if (paymentTransaction.settlementStatus !== "SETTLED") {
            paymentTransaction.settlementReference = null;
            paymentTransaction.settlementBatchKey = null;
            paymentTransaction.settledAt = null;
            paymentTransaction.settlementFailureReason = null;
        }
        await paymentTransaction.save({ session });

        return paymentTransaction;
    }, { label: "confirm-deposit" });
};

export const failDeposit = async ({ paymentTransactionId, failureReason, rawCallback = null }) => {
    return runRequiredTransaction(async (session) => {
        let paymentTransactionQuery = PaymentTransaction.findById(paymentTransactionId);
        if (session) {
            paymentTransactionQuery = paymentTransactionQuery.session(session);
        }
        const paymentTransaction = await paymentTransactionQuery;

        if (!paymentTransaction) {
            throw new Error("Payment transaction not found");
        }

        if (paymentTransaction.type !== "DEPOSIT") {
            throw new Error("Invalid payment transaction type");
        }

        if (paymentTransaction.status === "SUCCESS") {
            return paymentTransaction;
        }

        paymentTransaction.status = "FAILED";
        paymentTransaction.failureReason = String(failureReason || "Deposit failed");
        paymentTransaction.rawCallback = rawCallback || paymentTransaction.rawCallback;
        paymentTransaction.settlementStatus = "NOT_APPLICABLE";
        paymentTransaction.settlementReference = null;
        paymentTransaction.settlementBatchKey = null;
        paymentTransaction.settledAt = null;
        paymentTransaction.settlementFailureReason = null;
        await paymentTransaction.save({ session });

        return paymentTransaction;
    }, { label: "fail-deposit" });
};
