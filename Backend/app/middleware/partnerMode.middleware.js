import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const normalizeMode = () => String(process.env.PARTNER_OPERATING_MODE || "demo").trim().toLowerCase();
const normalizeModeValue = (value) => String(value || "").trim().toLowerCase();

const isLiveMode = () => {
    const mode = normalizeMode();
    return mode === "live" || mode === "production";
};

export const validatePartnerModeConfiguration = () => {
    if (!isLiveMode()) {
        return { mode: "demo", integrationTokenRequired: false };
    }

    const integrationToken = String(process.env.PARTNER_INTEGRATION_TOKEN || "").trim();
    if (!integrationToken) {
        throw new Error("PARTNER_INTEGRATION_TOKEN is required when PARTNER_OPERATING_MODE=live");
    }

    return { mode: "live", integrationTokenRequired: true };
};

export const requirePartnerIntegrationInLiveMode = (req, res, next) => {
    const partnerMode = normalizeModeValue(req.partner?.operatingMode);
    const effectiveMode = partnerMode || normalizeMode();
    const liveMode = effectiveMode === "live" || effectiveMode === "production";

    if (!liveMode) {
        return next();
    }

    if (req.partnerAuthMethod === "dashboard-session") {
        return res.status(403).json({
            status: "FAILED",
            reason: "Live write actions require signed server-to-server integration authentication"
        });
    }

    const expectedToken = String(process.env.PARTNER_INTEGRATION_TOKEN || "").trim();
    if (!expectedToken) {
        return res.status(500).json({
            status: "FAILED",
            reason: "Partner integration token is not configured"
        });
    }

    const providedToken = String(req.headers["x-integration-token"] || "").trim();
    if (!providedToken) {
        return res.status(403).json({
            status: "FAILED",
            reason: "Live mode requires integration token"
        });
    }

    const expectedBuffer = Buffer.from(expectedToken, "utf8");
    const providedBuffer = Buffer.from(providedToken, "utf8");
    const isMatch =
        expectedBuffer.length === providedBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, providedBuffer);

    if (!isMatch) {
        return res.status(403).json({
            status: "FAILED",
            reason: "Invalid integration token"
        });
    }

    return next();
};
