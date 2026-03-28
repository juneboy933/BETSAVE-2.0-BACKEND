import PaymentTransaction from "../database/models/paymentTransaction.model.js";
import Wallet from "../database/models/wallet.model.js";
import WithdrawalRequest from "../database/models/withdrawalRequest.model.js";
import { postLedger } from "./postLedger.service.js";
import { runInTransaction } from "./databaseSession.service.js";
import {
    getLiveWithdrawalMinBalanceKes
} from "./withdrawalEligibility.service.js";

const KENYA_PHONE_REGEX = /^\+254\d{9}$/;

const normalizePhone = (phone) => String(phone || "").trim();
const parsePositiveNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const validateAmount = (amount) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Invalid amount");
    }
    return value;
};

const buildReserveEventId = (withdrawalRequestId) => `WITHDRAWAL_${withdrawalRequestId}_RESERVE`;
const buildDisburseEventId = (withdrawalRequestId) => `WITHDRAWAL_${withdrawalRequestId}_DISBURSE`;
const buildReverseEventId = (withdrawalRequestId) => `WITHDRAWAL_${withdrawalRequestId}_REVERSE`;

export const createWithdrawalRequest = async ({
    userId,
    phone,
    amount,
    idempotencyKey,
    notes = null,
    withdrawalPolicy = null,
    paymentContext = null
}) => {
    if (!idempotencyKey) {
        throw new Error("idempotencyKey is required");
    }

    const normalizedPhone = normalizePhone(phone);
    if (!KENYA_PHONE_REGEX.test(normalizedPhone)) {
        throw new Error("Invalid phone number format. Use +254XXXXXXXXX");
    }

    const withdrawalAmount = validateAmount(amount);

    const existingPaymentTx = await PaymentTransaction.findOne({ idempotencyKey });
    if (existingPaymentTx) {
        const linkedWithdrawal = await WithdrawalRequest.findOne({ paymentTransactionId: existingPaymentTx._id });
        return { paymentTransaction: existingPaymentTx, withdrawalRequest: linkedWithdrawal };
    }

    const wallet = await Wallet.findOne({ userId }).lean();
    const currentBalance = Number(wallet?.balance || 0);
    const policy = withdrawalPolicy && typeof withdrawalPolicy === "object" ? withdrawalPolicy : null;
    const context = paymentContext && typeof paymentContext === "object" ? paymentContext : null;
    const operatingMode = String(policy?.operatingMode || "demo").trim().toLowerCase() === "live"
        ? "live"
        : "demo";
    const liveMinBalanceKes = parsePositiveNumber(
        policy?.liveMinBalanceKes,
        getLiveWithdrawalMinBalanceKes()
    );

    if (policy?.eligible === false) {
        throw new Error(String(policy.denialReason || "Withdrawal is not eligible"));
    }

    if (operatingMode === "live" && currentBalance < liveMinBalanceKes) {
        throw new Error(`Live withdrawals require a wallet balance of at least KES ${liveMinBalanceKes}`);
    }
    if (currentBalance < withdrawalAmount) {
        throw new Error("Insufficient wallet balance");
    }

    try {
        return await runInTransaction(async (session) => {
            const createOptions = session ? { session } : undefined;

            const [paymentTransaction] = await PaymentTransaction.create([{
                type: "WITHDRAWAL",
                channel: "B2C",
                status: "INITIATED",
                userId,
                partnerId: context?.partnerId || null,
                partnerName: context?.partnerName || null,
                requestedByType:
                    String(context?.requestedByType || "").trim().toUpperCase() === "PARTNER"
                        ? "PARTNER"
                        : "USER",
                phone: normalizedPhone,
                amount: withdrawalAmount,
                currency: "KES",
                externalRef: null,
                idempotencyKey
            }], createOptions);

            const [withdrawalRequest] = await WithdrawalRequest.create([{
                userId,
                amount: withdrawalAmount,
                status: "REQUESTED",
                paymentTransactionId: paymentTransaction._id,
                notes
            }], createOptions);

            const reserveEventId = buildReserveEventId(withdrawalRequest._id);
            await postLedger({
                userId,
                eventId: reserveEventId,
                reference: `withdrawal_reserve_${withdrawalRequest._id}`,
                entries: [
                    {
                        eventId: reserveEventId,
                        account: "USER_WALLET_LIABILITY",
                        amount: -withdrawalAmount
                    },
                    {
                        eventId: reserveEventId,
                        account: "WITHDRAWAL_PENDING",
                        amount: withdrawalAmount
                    }
                ],
                walletDelta: -withdrawalAmount,
                idempotencyQuery: {
                    eventId: reserveEventId,
                    userId,
                    account: "WITHDRAWAL_PENDING"
                },
                checkpointAccount: "WITHDRAWAL_PENDING",
                enforceNonNegativeBalance: true,
                session
            });

            withdrawalRequest.status = "RESERVED";
            paymentTransaction.status = "PENDING";

            await Promise.all([
                withdrawalRequest.save({ session }),
                paymentTransaction.save({ session })
            ]);

            return { paymentTransaction, withdrawalRequest };
        }, { label: "create-withdrawal-request" });
    } catch (error) {
        const paymentTransaction = await PaymentTransaction.findOne({ idempotencyKey }).select("_id");
        const withdrawalRequest = paymentTransaction?._id
            ? await WithdrawalRequest.findOne({ paymentTransactionId: paymentTransaction._id }).select("_id")
            : null;

        if (paymentTransaction?._id) {
            await PaymentTransaction.findByIdAndUpdate(paymentTransaction._id, {
                $set: {
                    status: "FAILED",
                    failureReason: String(error.message || "Withdrawal reservation failed")
                }
            });
        }
        if (withdrawalRequest?._id) {
            await WithdrawalRequest.findByIdAndUpdate(withdrawalRequest._id, {
                $set: {
                    status: "FAILED",
                    notes: notes || "Withdrawal reservation failed"
                }
            });
        }
        throw error;
    }
};

export const markWithdrawalDisbursed = async ({ withdrawalRequestId, providerRequestId = null, providerTransactionId = null, externalRef = null, rawCallback = null }) => {
    return runInTransaction(async (session) => {
        let withdrawalRequestQuery = WithdrawalRequest.findById(withdrawalRequestId);
        if (session) {
            withdrawalRequestQuery = withdrawalRequestQuery.session(session);
        }
        const withdrawalRequest = await withdrawalRequestQuery;
        if (!withdrawalRequest) {
            throw new Error("Withdrawal request not found");
        }

        let paymentTransactionQuery = PaymentTransaction.findById(withdrawalRequest.paymentTransactionId);
        if (session) {
            paymentTransactionQuery = paymentTransactionQuery.session(session);
        }
        const paymentTransaction = await paymentTransactionQuery;
        if (!paymentTransaction) {
            throw new Error("Payment transaction not found");
        }

        if (withdrawalRequest.status === "DISBURSED") {
            return { paymentTransaction, withdrawalRequest };
        }
        if (withdrawalRequest.status !== "RESERVED") {
            throw new Error("Withdrawal request is not in a disbursable state");
        }
        if (paymentTransaction.status === "FAILED") {
            throw new Error("Cannot disburse a failed withdrawal");
        }

        const disburseEventId = buildDisburseEventId(withdrawalRequest._id);
        await postLedger({
            userId: withdrawalRequest.userId,
            eventId: disburseEventId,
            reference: externalRef || `withdrawal_disburse_${withdrawalRequest._id}`,
            entries: [
                {
                    eventId: disburseEventId,
                    account: "WITHDRAWAL_PENDING",
                    amount: -withdrawalRequest.amount
                },
                {
                    eventId: disburseEventId,
                    account: "MPESA_DISBURSEMENT",
                    amount: withdrawalRequest.amount
                }
            ],
            walletDelta: 0,
            idempotencyQuery: {
                eventId: disburseEventId,
                userId: withdrawalRequest.userId,
                account: "MPESA_DISBURSEMENT"
            },
            checkpointAccount: "MPESA_DISBURSEMENT",
            session
        });

        withdrawalRequest.status = "DISBURSED";
        paymentTransaction.status = "SUCCESS";
        paymentTransaction.providerRequestId = providerRequestId || paymentTransaction.providerRequestId;
        paymentTransaction.providerTransactionId = providerTransactionId || paymentTransaction.providerTransactionId;
        paymentTransaction.externalRef = externalRef || paymentTransaction.externalRef;
        paymentTransaction.rawCallback = rawCallback || paymentTransaction.rawCallback;

        await Promise.all([
            withdrawalRequest.save({ session }),
            paymentTransaction.save({ session })
        ]);

        return { paymentTransaction, withdrawalRequest };
    }, { label: "mark-withdrawal-disbursed" });
};

export const markWithdrawalFailed = async ({ withdrawalRequestId, failureReason, rawCallback = null }) => {
    return runInTransaction(async (session) => {
        let withdrawalRequestQuery = WithdrawalRequest.findById(withdrawalRequestId);
        if (session) {
            withdrawalRequestQuery = withdrawalRequestQuery.session(session);
        }
        const withdrawalRequest = await withdrawalRequestQuery;
        if (!withdrawalRequest) {
            throw new Error("Withdrawal request not found");
        }

        let paymentTransactionQuery = PaymentTransaction.findById(withdrawalRequest.paymentTransactionId);
        if (session) {
            paymentTransactionQuery = paymentTransactionQuery.session(session);
        }
        const paymentTransaction = await paymentTransactionQuery;
        if (!paymentTransaction) {
            throw new Error("Payment transaction not found");
        }
        if (withdrawalRequest.status === "DISBURSED" || paymentTransaction.status === "SUCCESS") {
            return { paymentTransaction, withdrawalRequest };
        }

        const isReserved = withdrawalRequest.status === "RESERVED";
        if (isReserved) {
            const reverseEventId = buildReverseEventId(withdrawalRequest._id);
            await postLedger({
                userId: withdrawalRequest.userId,
                eventId: reverseEventId,
                reference: `withdrawal_reverse_${withdrawalRequest._id}`,
                entries: [
                    {
                        eventId: reverseEventId,
                        account: "WITHDRAWAL_PENDING",
                        amount: -withdrawalRequest.amount
                    },
                    {
                        eventId: reverseEventId,
                        account: "USER_WALLET_LIABILITY",
                        amount: withdrawalRequest.amount
                    }
                ],
                walletDelta: withdrawalRequest.amount,
                idempotencyQuery: {
                    eventId: reverseEventId,
                    userId: withdrawalRequest.userId,
                    account: "USER_WALLET_LIABILITY"
                },
                checkpointAccount: "USER_WALLET_LIABILITY",
                session
            });
        }

        withdrawalRequest.status = isReserved ? "REVERSED" : "FAILED";
        paymentTransaction.status = "FAILED";
        paymentTransaction.failureReason = String(failureReason || "Withdrawal failed");
        paymentTransaction.rawCallback = rawCallback || paymentTransaction.rawCallback;

        await Promise.all([
            withdrawalRequest.save({ session }),
            paymentTransaction.save({ session })
        ]);

        return { paymentTransaction, withdrawalRequest };
    }, { label: "mark-withdrawal-failed" });
};
