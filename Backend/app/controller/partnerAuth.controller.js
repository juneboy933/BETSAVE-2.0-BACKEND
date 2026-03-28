import PartnerAuth from "../../database/models/partnerAuth.model.js";
import Partner from "../../database/models/partner.model.js";
import {
    decryptPartnerApiSecret,
    encryptPartnerApiSecret,
    hashPassword,
    generateSalt,
    generatePartnerJWT,
    verifyPartnerJWT
} from "../../service/partnerAuth.service.js";
import crypto from "crypto";
import { buildClearedSessionCookie, buildSessionCookie, parseCookies } from "../http/cookie.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTPS_URL_REGEX = /^https:\/\//i;
const PARTNER_COOKIE_NAME = "betsave_partner_session";
const PARTNER_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

const attachPartnerSessionCookie = (res, token) => {
    res.setHeader("Set-Cookie", buildSessionCookie({
        name: PARTNER_COOKIE_NAME,
        value: token,
        maxAgeSeconds: PARTNER_SESSION_MAX_AGE_SECONDS
    }));
};

/**
 * Register a new partner with email and password.
 * Creates both Partner and PartnerAuth records.
 * Returns API credentials on success (shown once to user).
 */
export const registerPartnerAuth = async (req, res) => {
    try {
        const { name, email, password, webhookUrl, operatingMode } = req.body;
        const normalizedEmail = email?.trim().toLowerCase();

        // validation
        if (!name?.trim() || !normalizedEmail || !password) {
            return res.status(400).json({
                status: "FAILED",
                reason: "name, email and password are required"
            });
        }

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Invalid email format"
            });
        }

        if (password.length < 10) {
            return res.status(400).json({
                status: "FAILED",
                reason: "Password must be at least 10 characters"
            });
        }

        const normalizedWebhookUrl = String(webhookUrl || "").trim();
        const normalizedOperatingMode = operatingMode === "live" ? "live" : "demo";
        if (normalizedOperatingMode === "live") {
            if (!normalizedWebhookUrl) {
                return res.status(400).json({
                    status: "FAILED",
                    reason: "Live partners must provide a webhookUrl"
                });
            }
            if (!HTTPS_URL_REGEX.test(normalizedWebhookUrl)) {
                return res.status(400).json({
                    status: "FAILED",
                    reason: "Live partner webhookUrl must use HTTPS"
                });
            }
        }

        // check if partner name/email already exists
        const existingPartner = await Partner.findOne({
            $or: [{ name: name.trim() }, { email: normalizedEmail }]
        });
        if (existingPartner) {
            return res.status(409).json({
                status: "FAILED",
                reason: "Partner name or email already exists"
            });
        }

        const existingAuth = await PartnerAuth.findOne({ email: normalizedEmail });
        if (existingAuth) {
            return res.status(409).json({
                status: "FAILED",
                reason: "Email already registered"
            });
        }

        // generate API credentials
        const apiKey = crypto.randomBytes(16).toString("hex");
        const apiSecret = crypto.randomBytes(32).toString("hex");

        // create partner record
        const partner = await Partner.create({
            name: name.trim(),
            email: normalizedEmail,
            apiKey,
            apiSecretEncrypted: encryptPartnerApiSecret(apiSecret),
            webhookUrl: normalizedWebhookUrl || null,
            operatingMode: normalizedOperatingMode,
            status: "ACTIVE"
        });

        // create partner auth record
        const passwordSalt = generateSalt();
        const passwordHash = hashPassword(password, passwordSalt);

        await PartnerAuth.create({
            partnerId: partner._id,
            email: normalizedEmail,
            passwordHash,
            passwordSalt,
            status: "ACTIVE"
        });

        // generate JWT for immediate dashboard access
        const token = generatePartnerJWT(partner._id, normalizedEmail, partner.name);
        attachPartnerSessionCookie(res, token);

        // return API credentials (only once!)
        return res.status(201).json({
            status: "SUCCESS",
            partner: {
                id: partner._id,
                name: partner.name,
                email: normalizedEmail,
                operatingMode: partner.operatingMode
            },
            token,
            apiCredentials: {
                apiKey,
                apiSecret
            },
            securityNotice:
                "⚠️ Save your API Key and Secret now. We will not show them again. Store them securely on your backend for signing requests."
        });
    } catch (error) {
        console.error("registerPartnerAuth error:", error.message);
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

/**
 * Login partner with email and password.
 * Returns JWT token for dashboard access.
 */
export const loginPartnerAuth = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email?.trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.status(400).json({
                status: "FAILED",
                reason: "email and password are required"
            });
        }

        // find partner auth record
        const partnerAuth = await PartnerAuth.findOne({ email: normalizedEmail })
            .populate("partnerId", "name email operatingMode status");

        if (!partnerAuth) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid credentials"
            });
        }

        if (partnerAuth.status !== "ACTIVE") {
            return res.status(403).json({
                status: "FAILED",
                reason: "Account is suspended"
            });
        }

        // verify password
        const passwordHash = hashPassword(password, partnerAuth.passwordSalt);
        if (passwordHash !== partnerAuth.passwordHash) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid credentials"
            });
        }

        // update last login
        partnerAuth.lastLoginAt = new Date();
        await partnerAuth.save();

        // generate JWT
        const token = generatePartnerJWT(
            partnerAuth.partnerId._id,
            normalizedEmail,
            partnerAuth.partnerId.name
        );
        attachPartnerSessionCookie(res, token);

        return res.json({
            status: "SUCCESS",
            partner: {
                id: partnerAuth.partnerId._id,
                name: partnerAuth.partnerId.name,
                email: normalizedEmail,
                operatingMode: partnerAuth.partnerId.operatingMode || "demo"
            },
            token
        });
    } catch (error) {
        console.error("loginPartnerAuth error:", error.message);
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

/**
 * Refresh JWT token (optional but good practice).
 * Validates current token and issues a new one.
 */
export const refreshPartnerToken = async (req, res) => {
    try {
        const authHeader = String(req.headers.authorization || "").trim();
        const cookies = parseCookies(req.headers.cookie);
        const token = authHeader.replace(/^Bearer\s+/i, "").trim() || String(cookies[PARTNER_COOKIE_NAME] || "").trim();

        if (!token) {
            return res.status(401).json({
                status: "FAILED",
                reason: "No token provided"
            });
        }

        const decoded = verifyPartnerJWT(token);
        if (!decoded?.partnerId || !decoded?.email || !decoded?.name) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid or expired token"
            });
        }

        const partner = await Partner.findById(decoded.partnerId).select("name status");
        if (!partner || partner.status !== "ACTIVE") {
            return res.status(403).json({
                status: "FAILED",
                reason: "Partner not active"
            });
        }

        // regenerate token
        const newToken = generatePartnerJWT(decoded.partnerId, decoded.email, partner.name);
        attachPartnerSessionCookie(res, newToken);

        return res.json({
            status: "SUCCESS",
            refreshed: true,
            token: newToken
        });
    } catch (error) {
        console.error("refreshPartnerToken error:", error.message);
        return res.status(500).json({
            status: "FAILED",
            reason: error.message
        });
    }
};

export const logoutPartnerAuth = async (_req, res) => {
    res.setHeader("Set-Cookie", buildClearedSessionCookie(PARTNER_COOKIE_NAME));
    return res.json({
        status: "SUCCESS"
    });
};
