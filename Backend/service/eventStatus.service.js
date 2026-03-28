const normalizeEventStatus = (value) => String(value || "").trim().toUpperCase();
const normalizePaymentStatus = (value) => String(value || "").trim().toUpperCase();

export const deriveEffectiveEventState = ({ event, paymentTransaction = null }) => {
    const rawStatus = normalizeEventStatus(event?.status);
    const paymentStatus = normalizePaymentStatus(paymentTransaction?.status);

    if (rawStatus === "PROCESSED") {
        return {
            rawStatus,
            effectiveStatus: "PROCESSED",
            paymentStatus: paymentStatus || null,
            statusReason: null,
            shouldFinalize: false,
            nextStatus: "PROCESSED"
        };
    }

    if (rawStatus === "FAILED") {
        return {
            rawStatus,
            effectiveStatus: "FAILED",
            paymentStatus: paymentStatus || null,
            statusReason: paymentTransaction?.failureReason || event?.failureReason || null,
            shouldFinalize: false,
            nextStatus: "FAILED"
        };
    }

    if (paymentStatus === "SUCCESS") {
        return {
            rawStatus,
            effectiveStatus: "PROCESSED",
            paymentStatus,
            statusReason: null,
            shouldFinalize: true,
            nextStatus: "PROCESSED"
        };
    }

    if (paymentStatus === "FAILED") {
        return {
            rawStatus,
            effectiveStatus: "FAILED",
            paymentStatus,
            statusReason: paymentTransaction?.failureReason || event?.failureReason || null,
            shouldFinalize: true,
            nextStatus: "FAILED"
        };
    }

    if (paymentStatus === "PENDING" || paymentStatus === "INITIATED") {
        return {
            rawStatus,
            effectiveStatus: "PROCESSING",
            paymentStatus,
            statusReason: null,
            shouldFinalize: false,
            nextStatus: "PROCESSING"
        };
    }

    if (rawStatus === "RECEIVED") {
        return {
            rawStatus,
            effectiveStatus: "RECEIVED",
            paymentStatus: paymentStatus || null,
            statusReason: null,
            shouldFinalize: false,
            nextStatus: "RECEIVED"
        };
    }

    return {
        rawStatus,
        effectiveStatus: rawStatus || "PROCESSING",
        paymentStatus: paymentStatus || null,
        statusReason: null,
        shouldFinalize: false,
        nextStatus: rawStatus || "PROCESSING"
    };
};
