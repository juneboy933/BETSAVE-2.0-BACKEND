import mongoose from "mongoose";

import logger from "../app/logger.js";
import OperationalLog from "../database/models/operationalLog.model.js";
import { sanitizeLogMetadata } from "./redaction.service.js";

const toObjectIdOrNull = (value) =>
    mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;

const normalizeLevel = (value) => {
    const normalized = String(value || "INFO").trim().toUpperCase();
    if (["INFO", "WARN", "ERROR"].includes(normalized)) {
        return normalized;
    }
    return "INFO";
};

const normalizeMode = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "live") return "live";
    if (normalized === "demo") return "demo";
    return null;
};

const emitToLogger = (level, message, payload) => {
    const safeMetadata = sanitizeLogMetadata(payload.metadata || {});
    const loggerPayload = {
        category: payload.category,
        action: payload.action,
        status: payload.status || null,
        targetType: payload.targetType || null,
        targetId: payload.targetId || null,
        operatingMode: payload.operatingMode || null,
        partnerName: payload.partnerName || null,
        eventId: payload.eventId || null,
        paymentTransactionId: payload.paymentTransactionId || null,
        withdrawalRequestId: payload.withdrawalRequestId || null,
        metadata: safeMetadata
    };

    if (level === "ERROR") {
        logger.error(message, loggerPayload);
        return;
    }
    if (level === "WARN") {
        logger.warn(message, loggerPayload);
        return;
    }
    logger.info(message, loggerPayload);
};

export const recordOperationalLog = async (payload) => {
    const level = normalizeLevel(payload.level);
    const message = String(payload.message || "").trim();
    if (!payload.category || !payload.action || !message) {
        throw new Error("category, action, and message are required");
    }

    emitToLogger(level, message, payload);
    const safeMetadata = sanitizeLogMetadata(payload.metadata || {});

    return OperationalLog.create({
        level,
        category: String(payload.category).trim().toUpperCase(),
        action: String(payload.action).trim().toUpperCase(),
        status: payload.status ? String(payload.status).trim().toUpperCase() : null,
        message,
        operatingMode: normalizeMode(payload.operatingMode),
        partnerName: payload.partnerName ? String(payload.partnerName).trim() : null,
        userId: toObjectIdOrNull(payload.userId),
        eventId: payload.eventId ? String(payload.eventId).trim() : null,
        paymentTransactionId: toObjectIdOrNull(payload.paymentTransactionId),
        withdrawalRequestId: toObjectIdOrNull(payload.withdrawalRequestId),
        targetType: payload.targetType ? String(payload.targetType).trim().toUpperCase() : null,
        targetId: payload.targetId ? String(payload.targetId).trim() : null,
        externalRef: payload.externalRef ? String(payload.externalRef).trim() : null,
        metadata: safeMetadata
    });
};

export const recordOperationalLogSafe = async (payload) => {
    try {
        await recordOperationalLog(payload);
    } catch (error) {
        logger.error("Failed to persist operational log", {
            error: error.message,
            category: payload?.category || null,
            action: payload?.action || null
        });
    }
};
