import crypto from 'crypto';
import axios from 'axios';
import https from 'https';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import PartnerUser from '../database/models/partnerUser.model.js';

dotenv.config();

const KENYA_PHONE_REGEX = /^\+254\d{9}$/;

const normalizePhone = (phone) => String(phone || "").trim();
const resolveProviderUrl = () =>
    String(process.env.CRADLEVOICE_SMS_URL || process.env.CRADLEVOICE_URL || "").trim();
const resolveProviderTlsServername = () =>
    String(process.env.CRADLEVOICE_TLS_SERVERNAME || "").trim();
const toProviderPhone = (phone) => normalizePhone(phone).replace(/^\+/, "");

const isProviderFailure = (data) => {
    if (!data || typeof data !== "object") return false;
    if (typeof data.success === "boolean") return data.success === false;
    if (typeof data.error === "string" && data.error.trim()) return true;
    if (typeof data.message === "string" && /(invalid|failed|error|denied|rejected)/i.test(data.message)) {
        return true;
    }
    if (typeof data.status === "string") {
        const status = data.status.toUpperCase();
        return status === "FAILED" || status === "FAIL" || status === "ERROR";
    }
    return false;
};

const extractProviderStatusCode = (data) => {
    if (!data || typeof data !== "object") return null;
    const raw = data.statusCode ?? data.code ?? data.status_code;
    if (raw === undefined || raw === null) return null;
    return String(raw).trim().toUpperCase();
};

const isProviderSuccess = (data) => {
    if (!data) return false;
    if (typeof data === "string") {
        return /(success|sent|queued|ok)/i.test(data);
    }
    if (typeof data !== "object") return false;
    if (typeof data.success === "boolean") return data.success === true;
    if (typeof data.status === "string") {
        const status = data.status.toUpperCase();
        if (status === "SUCCESS" || status === "SENT" || status === "QUEUED" || status === "OK") {
            return true;
        }
    }
    return Boolean(data.messageId || data.requestId || data.id);
};

const isJsonLikeResponse = (response) => {
    const contentType = String(response?.headers?.["content-type"] || "").toLowerCase();
    return contentType.includes("application/json") || typeof response?.data === "object";
};

const generateOTP = (length) => {
    const digits = "0123456789";
    let otp = "";

    const randomBytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
        otp += digits[randomBytes[i] % 10];
    }

    return otp;
};

const storeOTP = async ({ partnerId, phone, otp }) => {
    const hashedOTP = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const partnerUser = await PartnerUser.findOneAndUpdate(
        { partnerId, phoneNumber: phone },
        {
            hashedOTP,
            otpExpiresAt: expiresAt,
            otpAttempts: 0
        },
        { returnDocument: "after" }
    );

    if (!partnerUser) {
        throw new Error("Partner user record not found for OTP storage");
    }

    return partnerUser;
};

export const sendOTP = async ({ partnerId, phone }) => {
    const normalizedPhone = normalizePhone(phone);
    const providerUrl = resolveProviderUrl();
    const tlsServername = resolveProviderTlsServername();

    if (!partnerId) {
        return {
            success: false,
            code: "INVALID_PARTNER",
            error: "Partner identifier is required for OTP delivery"
        };
    }

    if (!KENYA_PHONE_REGEX.test(normalizedPhone)) {
        return {
            success: false,
            code: "INVALID_PHONE",
            error: "Invalid phone number format. Use +254XXXXXXXXX"
        };
    }

    if (!process.env.CRADLEVOICE_API_KEY || !providerUrl) {
        return {
            success: false,
            code: "OTP_PROVIDER_CONFIG_MISSING",
            error: "OTP provider credentials or URL are not configured"
        };
    }

    if (!/^https?:\/\//i.test(providerUrl)) {
        return {
            success: false,
            code: "OTP_PROVIDER_CONFIG_INVALID",
            error: "OTP provider URL is invalid"
        };
    }

    try {
        const otp = generateOTP(4);
        await storeOTP({ partnerId, phone: normalizedPhone, otp });
        const providerPhone = toProviderPhone(normalizedPhone);
    
        const payload = {
            token: process.env.CRADLEVOICE_API_KEY,
            message: `Your OTP code is ${otp}. It expires in 5 minutes.`,
            phone: [providerPhone]
        };
    
        const requestConfig = {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        };

        if (/^https:\/\//i.test(providerUrl) && tlsServername) {
            requestConfig.httpsAgent = new https.Agent({
                servername: tlsServername
            });
        }

        const response = await axios.post(providerUrl, payload, requestConfig);

        const httpOk = response.status >= 200 && response.status < 300;
        const jsonLike = isJsonLikeResponse(response);
        const providerStatusCode = extractProviderStatusCode(response.data);

        if (isProviderFailure(response.data)) {
            return {
                success: false,
                code: "OTP_PROVIDER_REJECTED",
                error: "OTP provider rejected the request",
                providerHttpStatus: response.status,
                providerResponse: response.data
            };
        }

        const providerStatusCodeLooksSuccessful = ["200", "201", "202", "00", "0"].includes(providerStatusCode);

        if (!httpOk || !jsonLike || (!isProviderSuccess(response.data) && !providerStatusCodeLooksSuccessful)) {
            return {
                success: false,
                code: "OTP_PROVIDER_INVALID_RESPONSE",
                error: "OTP provider returned an unexpected response. Verify CRADLEVOICE_SMS_URL points to the API endpoint.",
                providerHttpStatus: response.status,
                providerStatusCode,
                providerResponse: response.data
            };
        }
    
        return {
            success: true,
            providerHttpStatus: response.status,
            providerStatusCode,
            providerResponse: response.data
        };
    } catch (err){
        const providerResponse = err.response?.data;
        console.error("Error sending OTP:", providerResponse || err.message);
        const errorText = String(err.message || "").toLowerCase();
        if (errorText.includes("unrecognized name")) {
            let providerHost = null;
            try {
                providerHost = new URL(providerUrl).hostname;
            } catch {
                providerHost = null;
            }
            return {
                success: false,
                code: "OTP_PROVIDER_TLS_SNI",
                error: "TLS/SNI mismatch with OTP provider host. Verify CRADLEVOICE_SMS_URL and set CRADLEVOICE_TLS_SERVERNAME if certificate host differs.",
                providerHost,
                tlsServername: tlsServername || null,
                providerResponse
            };
        }

        return {
            success: false,
            code: err.code === "ECONNABORTED" ? "OTP_PROVIDER_TIMEOUT" : "OTP_PROVIDER_ERROR",
            error: providerResponse?.message || err.message,
            providerResponse
        };
    }
};

export const verifyOTP = async ({ partnerId, phone, inputOTP }) => {
    const normalizedPhone = normalizePhone(phone);
    const otpValue = String(inputOTP || "").trim();
    const partnerUser = await PartnerUser.findOne({ partnerId, phoneNumber: normalizedPhone });

    if(!partnerUser || !partnerUser.hashedOTP) {
        throw new Error("OTP not found for this phone number");
    }

    if (!/^\d{4}$/.test(otpValue)) {
        throw new Error("Invalid OTP format");
    }

    if(new Date() > partnerUser.otpExpiresAt){
        throw new Error("OTP expired.");
    }

    if(partnerUser.otpAttempts >= 5){
        throw new Error("Too many OTP attempts. Please request a new OTP.");
    }

    const isMatch = await bcrypt.compare(otpValue, partnerUser.hashedOTP);

    if(!isMatch){
        partnerUser.otpAttempts += 1;
        await partnerUser.save();
        throw new Error("Invalid OTP. Please try again.");
    }

    // OTP is valid, reset attempts and return success
    partnerUser.hashedOTP = null;
    partnerUser.otpExpiresAt = null;
    partnerUser.otpAttempts = 0;
    await partnerUser.save();

    return {
        success: true,
        message: "OTP verified successfully.",
        partnerUser
    };
}
