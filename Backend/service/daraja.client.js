import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

let tokenCache = {
    accessToken: null,
    expiresAtMs: 0
};

const DEFAULT_TIMEOUT_MS = 15000;

const normalizeMsisdn = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    if (/^\+254\d{9}$/.test(raw)) {
        return raw.replace(/^\+/, "");
    }

    if (/^254\d{9}$/.test(raw)) {
        return raw;
    }

    if (/^0\d{9}$/.test(raw)) {
        return `254${raw.slice(1)}`;
    }

    return raw.replace(/^\+/, "");
};

const formatTimestamp = (date = new Date()) => {
    const pad = (num) => String(num).padStart(2, "0");
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join("");
};

const getDarajaEnv = () => {
    const env = String(process.env.DARAJA_ENV || "sandbox").trim().toLowerCase();
    if (env === "production" || env === "live") {
        return "production";
    }
    if (env === "sandbox") {
        return "sandbox";
    }
    throw new Error("Invalid DARAJA_ENV. Use 'sandbox' or 'production'");
};

const getBaseUrl = () => {
    const env = getDarajaEnv();
    if (env === "production") {
        return "https://api.safaricom.co.ke";
    }
    return "https://sandbox.safaricom.co.ke";
};

const getConfigValue = (key) => String(process.env[key] || "").trim();

const getHttpClient = () => axios.create({
    baseURL: getBaseUrl(),
    timeout: Number(process.env.DARAJA_HTTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
});

const assertCredentials = () => {
    const consumerKey = getConfigValue("DARAJA_CONSUMER_KEY");
    const consumerSecret = getConfigValue("DARAJA_CONSUMER_SECRET");

    if (!consumerKey || !consumerSecret) {
        throw new Error("Daraja consumer credentials are not configured");
    }

    return { consumerKey, consumerSecret };
};

export const isDarajaCollectionEnabled = () => {
    return Boolean(
        getConfigValue("DARAJA_CONSUMER_KEY") &&
        getConfigValue("DARAJA_CONSUMER_SECRET") &&
        getConfigValue("DARAJA_SHORTCODE") &&
        getConfigValue("DARAJA_PASSKEY") &&
        getConfigValue("DARAJA_STK_CALLBACK_URL")
    );
};

export const isDarajaDisbursementEnabled = () => {
    return Boolean(
        getConfigValue("DARAJA_CONSUMER_KEY") &&
        getConfigValue("DARAJA_CONSUMER_SECRET") &&
        getConfigValue("DARAJA_B2C_SHORTCODE") &&
        getConfigValue("DARAJA_B2C_INITIATOR_NAME") &&
        getConfigValue("DARAJA_B2C_SECURITY_CREDENTIAL") &&
        getConfigValue("DARAJA_B2C_TIMEOUT_URL") &&
        getConfigValue("DARAJA_B2C_RESULT_URL")
    );
};

export const getDarajaAccessToken = async () => {
    if (tokenCache.accessToken && tokenCache.expiresAtMs > Date.now() + 30000) {
        return tokenCache.accessToken;
    }

    const { consumerKey, consumerSecret } = assertCredentials();
    const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const client = getHttpClient();

    const response = await client.get("/oauth/v1/generate", {
        params: { grant_type: "client_credentials" },
        headers: {
            Authorization: `Basic ${basicAuth}`
        }
    });

    const accessToken = String(response?.data?.access_token || "").trim();
    const expiresInSeconds = Number(response?.data?.expires_in || 3599);

    if (!accessToken) {
        throw new Error("Failed to obtain Daraja access token");
    }

    tokenCache = {
        accessToken,
        expiresAtMs: Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 3599000)
    };

    return accessToken;
};

export const initiateStkPush = async ({ phone, amount, accountReference, transactionDesc, callbackUrl = null }) => {
    const normalizedPhone = normalizeMsisdn(phone);
    const numericAmount = Math.round(Number(amount));

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error("Invalid STK amount");
    }

    const shortCode = getConfigValue("DARAJA_SHORTCODE");
    const passkey = getConfigValue("DARAJA_PASSKEY");
    const resolvedCallbackUrl = String(callbackUrl || getConfigValue("DARAJA_STK_CALLBACK_URL")).trim();

    if (!shortCode || !passkey || !resolvedCallbackUrl) {
        throw new Error("Daraja STK configuration is incomplete");
    }

    const timestamp = formatTimestamp();
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString("base64");
    const token = await getDarajaAccessToken();
    const client = getHttpClient();

    const payload = {
        BusinessShortCode: shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: getConfigValue("DARAJA_STK_TRANSACTION_TYPE") || "CustomerPayBillOnline",
        Amount: numericAmount,
        PartyA: normalizedPhone,
        PartyB: shortCode,
        PhoneNumber: normalizedPhone,
        CallBackURL: resolvedCallbackUrl,
        AccountReference: String(accountReference || "BETSAVE"),
        TransactionDesc: String(transactionDesc || "Betsave Deposit")
    };

    const response = await client.post("/mpesa/stkpush/v1/processrequest", payload, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    return {
        ok: true,
        merchantRequestId: response?.data?.MerchantRequestID || null,
        checkoutRequestId: response?.data?.CheckoutRequestID || null,
        customerMessage: response?.data?.CustomerMessage || null,
        responseCode: response?.data?.ResponseCode || null,
        raw: response?.data || null
    };
};

export const initiateB2C = async ({ phone, amount, remarks, occasion, timeoutUrl = null, resultUrl = null }) => {
    const normalizedPhone = normalizeMsisdn(phone);
    const numericAmount = Math.round(Number(amount));

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error("Invalid B2C amount");
    }

    const shortCode = getConfigValue("DARAJA_B2C_SHORTCODE");
    const initiatorName = getConfigValue("DARAJA_B2C_INITIATOR_NAME");
    const securityCredential = getConfigValue("DARAJA_B2C_SECURITY_CREDENTIAL");
    const resolvedTimeoutUrl = String(timeoutUrl || getConfigValue("DARAJA_B2C_TIMEOUT_URL")).trim();
    const resolvedResultUrl = String(resultUrl || getConfigValue("DARAJA_B2C_RESULT_URL")).trim();

    if (!shortCode || !initiatorName || !securityCredential || !resolvedTimeoutUrl || !resolvedResultUrl) {
        throw new Error("Daraja B2C configuration is incomplete");
    }

    const token = await getDarajaAccessToken();
    const client = getHttpClient();

    const payload = {
        InitiatorName: initiatorName,
        SecurityCredential: securityCredential,
        CommandID: getConfigValue("DARAJA_B2C_COMMAND_ID") || "BusinessPayment",
        Amount: numericAmount,
        PartyA: shortCode,
        PartyB: normalizedPhone,
        Remarks: String(remarks || "Betsave Withdrawal"),
        QueueTimeOutURL: resolvedTimeoutUrl,
        ResultURL: resolvedResultUrl,
        Occasion: String(occasion || "Betsave")
    };

    const response = await client.post("/mpesa/b2c/v1/paymentrequest", payload, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    return {
        ok: true,
        originatorConversationId: response?.data?.OriginatorConversationID || null,
        conversationId: response?.data?.ConversationID || null,
        responseDescription: response?.data?.ResponseDescription || null,
        responseCode: response?.data?.ResponseCode || null,
        raw: response?.data || null
    };
};
