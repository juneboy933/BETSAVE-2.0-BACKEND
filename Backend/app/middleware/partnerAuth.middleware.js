import crypto from "crypto";
import Partner from "../../database/models/partner.model.js";
import { isDatabaseReady } from "../../database/config.js";
import {
    encryptPartnerApiSecret
} from "../../service/partnerAuth.service.js";
import { resolvePartnerSigningSecret } from "../../service/partnerSecret.service.js";

const SAFE_TIME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const normalizeBody = (body) => {
    if (!body || typeof body !== "object") return {};
    return Object.keys(body).length ? body : {};
};

const normalizePath = (url) => `/${String(url || "").replace(/^\/+/, "")}`;

export const verifyPartner = async (req, res, next) => {
    try {
        if (!isDatabaseReady()) {
            return res.status(503).json({
                status: "FAILED",
                reason: "Service temporarily unavailable"
            });
        }

        const apiKey = req.headers["x-api-key"];
        const signature = req.headers["x-signature"];
        const timestamp = req.headers["x-timestamp"];

        if (!apiKey || !signature || !timestamp) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Missing authentication headers"
            });
        }

        // Prevent replay attacks
        const now = Date.now();
        const requestTime = Number(timestamp);
        if (!Number.isFinite(requestTime)) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid timestamp"
            });
        }

        if (Math.abs(now - requestTime) > SAFE_TIME_WINDOW_MS) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Request expired"
            });
        }

        const partner = await Partner.findOne({ apiKey }).select("+apiSecret +apiSecretEncrypted");

        if (!partner) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid API Key"
            });
        }

        if (partner.status !== "ACTIVE") {
            return res.status(403).json({
                status: "FAILED",
                reason: "Partner not active"
            });
        }

        const canonicalBody = normalizeBody(req.body);
        const canonicalPath = normalizePath(req.originalUrl);
        const payload = `${timestamp}${req.method.toUpperCase()}${canonicalPath}${JSON.stringify(canonicalBody)}`;

        const encryptedApiSecret = String(partner.apiSecretEncrypted || "").trim();
        const legacyApiSecret = String(partner.apiSecret || "").trim();
        const signingSecret = resolvePartnerSigningSecret(partner);
        if (!signingSecret) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Partner secret not available for signature verification"
            });
        }

        const expectedSignature = crypto
            .createHmac("sha256", signingSecret)
            .update(payload)
            .digest("hex");

        if (!/^[a-f0-9]{64}$/i.test(signature)) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid signature format"
            });
        }

        const expectedBuffer = Buffer.from(expectedSignature, "hex");
        const incomingBuffer = Buffer.from(signature, "hex");

        if (
            expectedBuffer.length !== incomingBuffer.length ||
            !crypto.timingSafeEqual(expectedBuffer, incomingBuffer)
        ) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid signature"
            });
        }

        req.partner = {
            id: partner._id,
            name: partner.name,
            operatingMode: partner.operatingMode || "demo",
        };
        req.partnerAuthMethod = "signature";

        if (!encryptedApiSecret && legacyApiSecret) {
            Partner.updateOne(
                { _id: partner._id },
                {
                    $set: { apiSecretEncrypted: encryptPartnerApiSecret(legacyApiSecret) },
                    $unset: { apiSecret: "" }
                }
            ).catch(() => {});
        }

        next();
    } catch (error) {
        console.error("verifyPartner error:", error.message);

        const transientDbError =
            /timed out|connection <monitor>|topology was destroyed|network error|ECONNRESET|ETIMEDOUT/i.test(
                String(error.message || "")
            );

        return res.status(500).json({
            status: "FAILED",
            reason: transientDbError ? "Service temporarily unavailable" : "Partner verification failed"
        });
    }
};
