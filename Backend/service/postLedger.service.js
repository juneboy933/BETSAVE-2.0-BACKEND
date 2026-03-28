import Ledger from "../database/models/ledger.model.js";
import Wallet from "../database/models/wallet.model.js";
import { runInTransaction } from "./databaseSession.service.js";

const EPSILON = 0.000001;

const sumAmounts = (entries) => entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
const isDuplicateLedgerError = (error) =>
    error?.code === 11000 && /idempotencyKey/i.test(String(error?.message || ""));
const buildLedgerIdempotencyKey = ({ eventId, userId, account }) =>
    `${String(eventId)}::${String(userId)}::${String(account)}`;

export const postLedger = async ({
    userId,
    eventId,
    reference,
    entries,
    walletDelta = 0,
    idempotencyQuery = null,
    checkpointAccount = null,
    enforceNonNegativeBalance = false,
    session: providedSession = null
}) => {
    if (!userId) {
        throw new Error("userId is required");
    }

    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error("entries must be a non-empty array");
    }

    const normalizedWalletDelta = Number(walletDelta);
    if (!Number.isFinite(normalizedWalletDelta)) {
        throw new Error("Invalid walletDelta");
    }

    const total = sumAmounts(entries);
    if (!Number.isFinite(total) || Math.abs(total) > EPSILON) {
        throw new Error("Ledger imbalance detected");
    }

    const execute = async (session) => {
            if (idempotencyQuery && typeof idempotencyQuery === "object") {
                let existingEntryQuery = Ledger.findOne(idempotencyQuery).select("_id");
                if (session) {
                    existingEntryQuery = existingEntryQuery.session(session);
                }

                const existingEntry = await existingEntryQuery;

                if (existingEntry) {
                    let existingWalletQuery = Wallet.findOne({ userId });
                    if (session) {
                        existingWalletQuery = existingWalletQuery.session(session);
                    }

                    const existingWallet = await existingWalletQuery;
                    return {
                        wallet: existingWallet,
                        ledgerDocs: [],
                        wasDuplicate: true
                    };
                }
            }

            let currentWalletQuery = Wallet.findOne({ userId }).select("balance");
            if (session) {
                currentWalletQuery = currentWalletQuery.session(session);
            }

            const currentWallet = await currentWalletQuery;
            const currentBalance = Number(currentWallet?.balance || 0);
            if (enforceNonNegativeBalance && currentBalance + normalizedWalletDelta < -EPSILON) {
                throw new Error("Insufficient wallet balance");
            }

            const docsToInsert = entries.map((entry) => ({
                eventId: entry.eventId || eventId,
                userId,
                account: entry.account,
                amount: Number(entry.amount),
                currency: entry.currency || "KES",
                reference: entry.reference || reference,
                idempotencyKey: buildLedgerIdempotencyKey({
                    eventId: entry.eventId || eventId,
                    userId,
                    account: entry.account
                })
            }));

            const insertOptions = session ? { session, ordered: true } : { ordered: true };
            const ledgerDocs = await Ledger.insertMany(docsToInsert, insertOptions);

            const checkpointEntry = checkpointAccount
                ? ledgerDocs.find((entry) => entry.account === checkpointAccount)
                : ledgerDocs[ledgerDocs.length - 1];

            const walletUpdate = {
                $set: {
                    ...(checkpointEntry ? { lastProcessedLedgerId: checkpointEntry._id } : {})
                }
            };

            if (Math.abs(normalizedWalletDelta) > EPSILON) {
                walletUpdate.$inc = { balance: normalizedWalletDelta };
            }

            const wallet = await Wallet.findOneAndUpdate(
                { userId },
                walletUpdate,
                {
                    ...(session ? { session } : {}),
                    upsert: true,
                    returnDocument: "after",
                    setDefaultsOnInsert: true
                }
            );

            return {
                wallet,
                ledgerDocs,
                wasDuplicate: false
            };
        };

    try {
        if (providedSession) {
            return await execute(providedSession);
        }

        return await runInTransaction(execute, { label: "post-ledger" });
    } catch (error) {
        if (isDuplicateLedgerError(error)) {
            const existingWallet = await Wallet.findOne({ userId });
            return {
                wallet: existingWallet,
                ledgerDocs: [],
                wasDuplicate: true
            };
        }
        throw error;
    }
};
