import mongoose from "mongoose";
import logger from "../app/logger.js";

let transactionSupport = null;
let fallbackWarningLogged = false;

export const setTransactionSupport = (supported) => {
    transactionSupport = typeof supported === "boolean" ? supported : null;
};

export const supportsTransactions = () => transactionSupport === true;

const logFallbackWarningOnce = (label) => {
    if (fallbackWarningLogged) {
        return;
    }

    fallbackWarningLogged = true;
    logger.warn(
        `[db] MongoDB transactions are unavailable; running '${label}' without transaction protection`
    );
};

export const runInTransaction = async (work, options = {}) => {
    const label = String(options.label || "database-operation").trim() || "database-operation";
    const allowFallback = options.allowFallback !== false;

    if (supportsTransactions()) {
        const session = await mongoose.startSession();

        try {
            let result;
            await session.withTransaction(async () => {
                result = await work(session);
            });
            return result;
        } finally {
            await session.endSession();
        }
    }

    if (!allowFallback) {
        throw new Error(
            `MongoDB transactions are required for '${label}' but the current deployment does not support them`
        );
    }

    logFallbackWarningOnce(label);
    return work(null);
};
