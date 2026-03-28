import { registerPartner } from "../../service/registerPartner.service.js";
import { registerPartnerUser } from "../../service/registerPartnerUser.service.js";
import Partner from "../../database/models/partner.model.js";
import PartnerUser from "../../database/models/partnerUser.model.js";
import User from "../../database/models/user.model.js";
import { sendOTP, verifyOTP } from "../../service/otp.service.js";
import crypto from "crypto";
import { sanitizeStructuredData, summarizeUrlForDisplay } from "../../service/redaction.service.js";

const CREDENTIALS_SECURITY_NOTICE =
    "Store your API key and API secret securely in your backend secret manager. Do not expose them in client-side code.";
const HTTPS_URL_REGEX = /^https:\/\//i;
const summarizeOtpProviderResponse = (providerResponse) => {
    const safe = sanitizeStructuredData(providerResponse || {});
    return safe && typeof safe === "object"
        ? {
            status: safe.status || null,
            statusCode: safe.statusCode || safe.code || null,
            transactionId: safe.transactionId || safe.requestId || safe.id || null
        }
        : null;
};

export const createPartner = async (req, res) => {
    try {
        const { name, webhookUrl, operatingMode } = req.body;

        if(!name || !webhookUrl){
            return res.status(400).json({
                status: 'FAILED',
                reason: 'Name or webhook URL not provided.' 
            });
        }

        const partner = await registerPartner({name, webhookUrl, operatingMode});

        // also issue dashboard token so the creator can immediately log in
        const jwt = await import('jsonwebtoken');
        const token = jwt.sign(
            {
                partnerId: partner._id.toString(),
                name: partner.name,
                operatingMode: partner.operatingMode || 'demo'
            },
            process.env.PARTNER_JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.status(201).json({
            status: 'SUCCESS',
            partner,
            token,
            securityNotice: CREDENTIALS_SECURITY_NOTICE
        });

    } catch (error) {
        return res.status(400).json({
            status: 'FAILED',
            reason: error.message
        });
    }
};

export const loginPartner = async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.body;

        if (!apiKey || !apiSecret) {
            return res.status(400).json({
                status: "FAILED",
                reason: "apiKey and apiSecret are required"
            });
        }

        const partner = await Partner.findOne({ apiKey }).select("_id name apiKey apiSecret status webhookUrl operatingMode");
        if (!partner) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid credentials"
            });
        }

        if (partner.status !== "ACTIVE") {
            return res.status(403).json({
                status: "FAILED",
                reason: "Partner is suspended"
            });
        }

        const expected = Buffer.from(partner.apiSecret, "utf8");
        const provided = Buffer.from(apiSecret, "utf8");
        const valid =
            expected.length === provided.length &&
            crypto.timingSafeEqual(expected, provided);

        if (!valid) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid credentials"
            });
        }

        // generate session token for dashboard usage
        const jwt = await import('jsonwebtoken');
        const token = jwt.sign(
            {
                partnerId: partner._id.toString(),
                name: partner.name,
                operatingMode: partner.operatingMode || "demo"
            },
            process.env.PARTNER_JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.json({
            status: "SUCCESS",
            partner: {
                id: partner._id,
                name: partner.name,
                webhookUrl: partner.webhookUrl,
                status: partner.status,
                operatingMode: partner.operatingMode || "demo"
            },
            token,
            securityNotice: CREDENTIALS_SECURITY_NOTICE
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getPartnerCredentials = async (req, res) => {
    try {
        if (!req.partner?.id) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Partner not authenticated"
            });
        }

        const partner = await Partner.findById(req.partner.id)
            .select("_id name apiKey apiSecret status operatingMode");

        if (!partner) {
            return res.status(404).json({
                status: "FAILED",
                reason: "Partner not found"
            });
        }

        if (partner.status !== "ACTIVE") {
            return res.status(403).json({
                status: "FAILED",
                reason: "Partner is suspended"
            });
        }

        return res.json({
            status: "SUCCESS",
            credentials: {
                apiKey: partner.apiKey,
                apiSecret: partner.apiSecret
            },
            operatingMode: partner.operatingMode || "demo",
            securityNotice: CREDENTIALS_SECURITY_NOTICE
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const getPartnerOperatingMode = async (req, res) => {
    try {
        if (!req.partner?.id) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Partner not authenticated"
            });
        }

        const partner = await Partner.findById(req.partner.id)
            .select("_id name status operatingMode");
        if (!partner) {
            return res.status(404).json({
                status: "FAILED",
                reason: "Partner not found"
            });
        }

        return res.json({
            status: "SUCCESS",
            partner: {
                id: String(partner._id),
                name: partner.name,
                operatingMode: partner.operatingMode || "demo",
                accountStatus: partner.status
            }
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const setPartnerOperatingMode = async (req, res) => {
    try {
        if (!req.partner?.id) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Partner not authenticated"
            });
        }

        const requestedMode = String(req.body?.operatingMode || "").trim().toLowerCase();
        if (!["demo", "live"].includes(requestedMode)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "operatingMode must be 'demo' or 'live'"
            });
        }

        if (requestedMode === "live") {
            const existingPartner = await Partner.findById(req.partner.id)
                .select("_id webhookUrl");
            if (!existingPartner) {
                return res.status(404).json({
                    status: "FAILED",
                    reason: "Partner not found"
                });
            }

            if (!String(existingPartner.webhookUrl || "").trim()) {
                return res.status(400).json({
                    status: "FAILED",
                    reason: "Partner must configure a webhookUrl before switching to live mode"
                });
            }

            if (!HTTPS_URL_REGEX.test(String(existingPartner.webhookUrl || "").trim())) {
                return res.status(400).json({
                    status: "FAILED",
                    reason: "Partner webhookUrl must use HTTPS before switching to live mode"
                });
            }
        }

        const partner = await Partner.findByIdAndUpdate(
            req.partner.id,
            { $set: { operatingMode: requestedMode } },
            { returnDocument: "after" }
        ).select("_id name operatingMode");
        if (!partner) {
            return res.status(404).json({
                status: "FAILED",
                reason: "Partner not found"
            });
        }

        return res.json({
            status: "SUCCESS",
            partner: {
                id: String(partner._id),
                name: partner.name,
                operatingMode: partner.operatingMode || "demo"
            }
        });
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const registerUserFromPartner = async (req, res) => {
    try {
        if (!req.partner) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Partner not authenticated"
            });
        }

        const { phone, autoSavingsEnabled } = req.body;
        const result = await registerPartnerUser({
            partner: req.partner,
            phone,
            autoSavingsEnabled
        });

        let otp = null;
        let otpProviderResponse = null;
        if (result.requiresOtp) {
            otp = await sendOTP({
                partnerId: req.partner.id,
                phone: result.phoneNumber
            });

            if (!otp.success) {
                const otpStatusCodeByCode = {
                    INVALID_PARTNER: 400,
                    INVALID_PHONE: 400,
                    OTP_PROVIDER_CONFIG_MISSING: 500,
                    OTP_PROVIDER_CONFIG_INVALID: 500,
                    OTP_PROVIDER_TIMEOUT: 504,
                    OTP_PROVIDER_REJECTED: 502,
                    OTP_PROVIDER_INVALID_RESPONSE: 502,
                    OTP_PROVIDER_TLS_SNI: 502,
                    OTP_PROVIDER_ERROR: 502
                };
                const otpStatusCode = otpStatusCodeByCode[otp.code] || 502;

                return res.status(otpStatusCode).json({
                    status: "FAILED",
                    reason: "User created but OTP delivery failed",
                    code: otp.code || "OTP_DELIVERY_FAILED",
                    details: otp.error,
                    providerHost: otp.providerHost || null,
                    tlsServername: otp.tlsServername || null,
                    providerHttpStatus: otp.providerHttpStatus || null,
                    providerStatusCode: otp.providerStatusCode || null,
                    provider: summarizeOtpProviderResponse(otp.providerResponse)
                });
            }
            otpProviderResponse = summarizeOtpProviderResponse(otp.providerResponse);
        }

        const structuredOtp = result.requiresOtp
            ? {
                required: true,
                requestAccepted: true,
                delivered: false,
                deliveryGuaranteed: false,
                message: "OTP request accepted by provider. Delivery to handset is asynchronous.",
                provider: otpProviderResponse
                    ? {
                        status: otpProviderResponse.status || null,
                        statusCode: otpProviderResponse.statusCode || null,
                        transactionId: otpProviderResponse.transactionId || null,
                        deliveryHost: summarizeUrlForDisplay(process.env.CRADLEVOICE_SMS_URL || process.env.CRADLEVOICE_URL || null)
                    }
                    : null
            }
            : {
                required: false,
                requestAccepted: false,
                delivered: false,
                deliveryGuaranteed: false,
                message: "OTP not required because user is already verified.",
                provider: null
            };

        return res.status(201).json({
            status: "SUCCESS",
            ...result,
            otpSent: result.requiresOtp,
            otp: structuredOtp
        });
    } catch (error) {
        const statusCode = error.message === "Invalid phone number" ? 400 : 500;
        return res.status(statusCode).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const verifyPartnerUserOtp = async (req, res) => {
    try {
        if (!req.partner) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Partner not authenticated"
            });
        }

        const { phone, otp } = req.body;
        if (!phone || !otp) {
            return res.status(400).json({
                status: "FAILED",
                reason: "phone and otp are required"
            });
        }

        const normalizedPhone = phone.trim();
        await verifyOTP({
            partnerId: req.partner.id,
            phone: normalizedPhone,
            inputOTP: String(otp).trim()
        });

        const [partnerUser, user] = await Promise.all([
            PartnerUser.findOneAndUpdate(
                { partnerId: req.partner.id, phoneNumber: normalizedPhone },
                { $set: { status: "VERIFIED" } },
                { returnDocument: "after" }
            ),
            User.findOneAndUpdate(
                { phoneNumber: normalizedPhone },
                { $set: { verified: true, status: "ACTIVE" } },
                { returnDocument: "after" }
            )
        ]);

        return res.json({
            status: "SUCCESS",
            message: "OTP verified successfully",
            partnerUser: partnerUser
                ? {
                    id: partnerUser._id,
                    phoneNumber: partnerUser.phoneNumber,
                    status: partnerUser.status,
                    autoSavingsEnabled: !!partnerUser.autoSavingsEnabled
                }
                : null,
            user: user
                ? {
                    id: user._id,
                    phoneNumber: user.phoneNumber,
                    verified: user.verified,
                    status: user.status
                }
                : null
        });
    } catch (error) {
        const knownErrors = new Set([
            "OTP not found for this phone number",
            "Invalid OTP format",
            "OTP expired.",
            "Too many OTP attempts. Please request a new OTP.",
            "Invalid OTP. Please try again."
        ]);

        return res.status(knownErrors.has(error.message) ? 400 : 500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};
