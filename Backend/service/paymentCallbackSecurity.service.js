import crypto from "crypto";

const getCallbackSecret = () => String(process.env.PAYMENT_CALLBACK_TOKEN || "").trim();

const buildMessage = ({ callbackType, resourceId }) =>
    `${String(callbackType || "").trim().toLowerCase()}::${String(resourceId || "").trim()}`;

export const buildSignedCallbackToken = ({ callbackType, resourceId }) => {
    const secret = getCallbackSecret();
    if (!secret) {
        throw new Error("Payment callback token is not configured");
    }

    if (!callbackType || !resourceId) {
        throw new Error("callbackType and resourceId are required to build a callback token");
    }

    const message = buildMessage({ callbackType, resourceId });
    return crypto.createHmac("sha256", secret).update(message).digest("hex");
};

export const verifySignedCallbackToken = ({ callbackType, resourceId, providedToken }) => {
    const normalizedProvidedToken = String(providedToken || "").trim();
    if (!normalizedProvidedToken || !callbackType || !resourceId) {
        return false;
    }

    const expectedToken = buildSignedCallbackToken({ callbackType, resourceId });
    const expectedBuffer = Buffer.from(expectedToken, "utf8");
    const providedBuffer = Buffer.from(normalizedProvidedToken, "utf8");

    return (
        expectedBuffer.length === providedBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, providedBuffer)
    );
};

export const buildSignedCallbackUrl = ({ baseUrl, callbackType, resourceId }) => {
    const normalizedBaseUrl = String(baseUrl || "").trim();
    if (!normalizedBaseUrl) {
        throw new Error("Callback URL is required");
    }

    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("callbackType", String(callbackType || "").trim().toLowerCase());
    url.searchParams.set("callbackToken", buildSignedCallbackToken({ callbackType, resourceId }));

    if (String(callbackType || "").trim().toLowerCase() === "deposit") {
        url.searchParams.set("paymentTransactionId", String(resourceId));
    } else if (String(callbackType || "").trim().toLowerCase() === "withdrawal") {
        url.searchParams.set("withdrawalRequestId", String(resourceId));
    } else {
        throw new Error("Unsupported callback type");
    }

    return url.toString();
};
