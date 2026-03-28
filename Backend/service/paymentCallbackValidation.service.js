const mapMetadataItems = (items, keyField = "Name") => {
    if (!Array.isArray(items)) {
        return {};
    }

    return items.reduce((acc, item) => {
        const key = String(item?.[keyField] || "").trim();
        if (!key) {
            return acc;
        }

        acc[key] = item?.Value;
        return acc;
    }, {});
};

export const normalizeCallbackPhone = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    if (/^\+254\d{9}$/.test(raw)) {
        return raw;
    }
    if (/^254\d{9}$/.test(raw)) {
        return `+${raw}`;
    }
    if (/^0\d{9}$/.test(raw)) {
        return `+254${raw.slice(1)}`;
    }

    return raw.startsWith("+") ? raw : `+${raw}`;
};

export const parseDepositCallbackPayload = (payload) => {
    const stkCallback = payload?.Body?.stkCallback;

    if (stkCallback) {
        const metadata = mapMetadataItems(stkCallback?.CallbackMetadata?.Item);
        const resultCode = Number(stkCallback?.ResultCode);

        return {
            paymentTransactionId: payload?.paymentTransactionId || null,
            providerRequestId: stkCallback?.CheckoutRequestID || payload?.providerRequestId || null,
            providerTransactionId: metadata?.MpesaReceiptNumber || stkCallback?.MerchantRequestID || payload?.providerTransactionId || null,
            externalRef: metadata?.AccountReference || payload?.externalRef || null,
            callbackAmount: metadata?.Amount ?? payload?.amount ?? null,
            callbackPhone: metadata?.PhoneNumber || payload?.phone || null,
            status: Number.isFinite(resultCode) && resultCode === 0 ? "SUCCESS" : "FAILED",
            failureReason: stkCallback?.ResultDesc || payload?.failureReason || null,
            rawCallback: payload
        };
    }

    return {
        paymentTransactionId: payload?.paymentTransactionId || null,
        providerRequestId: payload?.providerRequestId || null,
        providerTransactionId: payload?.providerTransactionId || null,
        externalRef: payload?.externalRef || null,
        callbackAmount: payload?.amount ?? null,
        callbackPhone: payload?.phone || null,
        status: payload?.status || null,
        failureReason: payload?.failureReason || null,
        rawCallback: payload
    };
};

export const parseWithdrawalCallbackPayload = (payload) => {
    const result = payload?.Result;
    const resultParameters = mapMetadataItems(result?.ResultParameters?.ResultParameter, "Key");

    if (result) {
        const resultCode = Number(result?.ResultCode);

        return {
            withdrawalRequestId: payload?.withdrawalRequestId || null,
            providerRequestId: result?.OriginatorConversationID || payload?.providerRequestId || null,
            providerTransactionId: result?.ConversationID || result?.TransactionID || payload?.providerTransactionId || null,
            externalRef: payload?.externalRef || resultParameters?.Occasion || null,
            callbackAmount: resultParameters?.TransactionAmount ?? payload?.amount ?? null,
            callbackPhone: resultParameters?.ReceiverPartyPublicName || payload?.phone || null,
            status: Number.isFinite(resultCode) && resultCode === 0 ? "SUCCESS" : "FAILED",
            failureReason: result?.ResultDesc || payload?.failureReason || null,
            rawCallback: payload
        };
    }

    return {
        withdrawalRequestId: payload?.withdrawalRequestId || null,
        providerRequestId: payload?.providerRequestId || null,
        providerTransactionId: payload?.providerTransactionId || null,
        externalRef: payload?.externalRef || null,
        callbackAmount: payload?.amount ?? null,
        callbackPhone: payload?.phone || null,
        status: payload?.status || null,
        failureReason: payload?.failureReason || null,
        rawCallback: payload
    };
};

export const ensureCallbackResourceBinding = ({ callbackType, hintedResourceId, payloadResourceId = null, resolvedResourceId = null }) => {
    const normalizedCallbackType = String(callbackType || "callback").trim().toLowerCase();
    const normalizedHintedResourceId = String(hintedResourceId || "").trim();
    const normalizedPayloadResourceId = String(payloadResourceId || "").trim();
    const normalizedResolvedResourceId = String(resolvedResourceId || "").trim();

    if (!normalizedHintedResourceId) {
        throw new Error(`${normalizedCallbackType} callback resource id is missing`);
    }
    if (normalizedPayloadResourceId && normalizedPayloadResourceId !== normalizedHintedResourceId) {
        throw new Error(`${normalizedCallbackType} callback resource id mismatch`);
    }
    if (normalizedResolvedResourceId && normalizedResolvedResourceId !== normalizedHintedResourceId) {
        throw new Error(`${normalizedCallbackType} callback resolved to a different resource`);
    }

    return normalizedHintedResourceId;
};

export const validateDepositSettlement = ({ paymentTransaction, parsed, requireStructuredMetadata = false }) => {
    const expectedAmount = Number(paymentTransaction?.amount || 0);
    const callbackAmount = Number(parsed?.callbackAmount);
    const expectedPhone = normalizeCallbackPhone(paymentTransaction?.phone);
    const callbackPhone = normalizeCallbackPhone(parsed?.callbackPhone);
    const expectedExternalRef = String(paymentTransaction?.externalRef || "").trim();
    const callbackExternalRef = String(parsed?.externalRef || "").trim();
    const expectedProviderRequestId = String(paymentTransaction?.providerRequestId || "").trim();
    const callbackProviderRequestId = String(parsed?.providerRequestId || "").trim();

    if (requireStructuredMetadata && !Number.isFinite(callbackAmount)) {
        throw new Error("Deposit callback amount is missing");
    }
    if (requireStructuredMetadata && !callbackPhone) {
        throw new Error("Deposit callback phone is missing");
    }
    if (Number.isFinite(callbackAmount) && callbackAmount !== expectedAmount) {
        throw new Error("Deposit callback amount mismatch");
    }
    if (callbackPhone && expectedPhone && callbackPhone !== expectedPhone) {
        throw new Error("Deposit callback phone mismatch");
    }
    if (callbackExternalRef && expectedExternalRef && callbackExternalRef !== expectedExternalRef) {
        throw new Error("Deposit callback reference mismatch");
    }
    if (callbackProviderRequestId && expectedProviderRequestId && callbackProviderRequestId !== expectedProviderRequestId) {
        throw new Error("Deposit callback request mismatch");
    }
};

export const validateWithdrawalSettlement = ({
    paymentTransaction,
    withdrawalRequest,
    parsed,
    requireStructuredMetadata = false
}) => {
    const expectedAmount = Number(withdrawalRequest?.amount ?? paymentTransaction?.amount ?? 0);
    const callbackAmount = Number(parsed?.callbackAmount);
    const expectedExternalRef = String(paymentTransaction?.externalRef || "").trim();
    const callbackExternalRef = String(parsed?.externalRef || "").trim();
    const expectedProviderRequestId = String(paymentTransaction?.providerRequestId || "").trim();
    const callbackProviderRequestId = String(parsed?.providerRequestId || "").trim();

    if (requireStructuredMetadata && !Number.isFinite(callbackAmount)) {
        throw new Error("Withdrawal callback amount is missing");
    }
    if (Number.isFinite(callbackAmount) && callbackAmount !== expectedAmount) {
        throw new Error("Withdrawal callback amount mismatch");
    }
    if (callbackExternalRef && expectedExternalRef && callbackExternalRef !== expectedExternalRef) {
        throw new Error("Withdrawal callback reference mismatch");
    }
    if (callbackProviderRequestId && expectedProviderRequestId && callbackProviderRequestId !== expectedProviderRequestId) {
        throw new Error("Withdrawal callback request mismatch");
    }
};
