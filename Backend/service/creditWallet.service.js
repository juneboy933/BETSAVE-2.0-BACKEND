import { postLedger } from "./postLedger.service.js";

export const creditWallet = async ({ userId, eventId, amount, reference }) => {
    const creditAmount = Number(amount);

    if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
        throw new Error("Invalid credit amount");
    }

    const entries = [
        {
            eventId,
            account: "OPERATOR_CLEARING",
            amount: -creditAmount,
            reference
        },
        {
            eventId,
            account: "USER_SAVINGS",
            amount: +creditAmount,
            reference
        }
    ];

    const { wallet } = await postLedger({
        userId,
        eventId,
        reference,
        entries,
        walletDelta: creditAmount,
        idempotencyQuery: {
            eventId,
            userId,
            account: "USER_SAVINGS"
        },
        checkpointAccount: "USER_SAVINGS"
    });

    return wallet;
};
