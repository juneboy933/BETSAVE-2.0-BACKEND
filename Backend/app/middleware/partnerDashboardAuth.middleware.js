import jwt from "jsonwebtoken";
import Partner from "../../database/models/partner.model.js";
import env from "../config.js";
import { parseCookies } from "../http/cookie.js";
import { verifyPartner } from "./partnerAuth.middleware.js";

/**
 * Authenticate partner dashboard requests.  Allows either:
 *  - Bearer token issued by loginPartner (expires, no secret exposure)
 *  - Legacy signed request using apiKey/apiSecret (for backwards compatibility)
 *
 * Dashboard routes use this middleware instead of verifyPartner directly.
 */
const resolvePartnerDashboardSession = async (req) => {
    const auth = String(req.headers.authorization || "").trim();
    const cookies = parseCookies(req.headers.cookie);
    const token = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : String(cookies.betsave_partner_session || "").trim();

    if (token) {
        const payload = jwt.verify(token, env.PARTNER_JWT_SECRET);
        const partner = await Partner.findById(payload.partnerId).select("name status operatingMode");
        if (!partner || partner.status !== "ACTIVE") {
            const error = new Error("Partner not active");
            error.statusCode = 403;
            throw error;
        }
        req.partner = {
            id: partner._id,
            name: partner.name,
            operatingMode: partner.operatingMode || "demo"
        };
        req.partnerAuthMethod = "dashboard-session";
        return true;
    }
    return false;
};

export const verifyPartnerDashboardSession = async (req, res, next) => {
    try {
        const hasSession = await resolvePartnerDashboardSession(req);
        if (!hasSession) {
            return res.status(401).json({ status: "FAILED", reason: "Partner dashboard session required" });
        }
        return next();
    } catch (err) {
        console.error("partner dashboard token error", err.message);
        return res.status(err.statusCode || 401).json({ status: "FAILED", reason: err.statusCode === 403 ? "Partner not active" : "Invalid or expired token" });
    }
};

export const verifyPartnerDashboard = async (req, res, next) => {
    try {
        const hasSession = await resolvePartnerDashboardSession(req);
        if (hasSession) {
            return next();
        }
    } catch (err) {
        console.error("partner dashboard token error", err.message);
        return res.status(err.statusCode || 401).json({ status: "FAILED", reason: err.statusCode === 403 ? "Partner not active" : "Invalid or expired token" });
    }

    return verifyPartner(req, res, next);
};
