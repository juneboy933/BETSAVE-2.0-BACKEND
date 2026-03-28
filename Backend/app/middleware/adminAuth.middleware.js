import Admin from "../../database/models/admin.model.js";
import env from "../config.js";
import { parseCookies } from "../http/cookie.js";
import { hashToken } from "../../service/adminAuth.service.js";
import { canAdminManageInvitations } from "../../service/adminPermissions.service.js";

export const verifyAdmin = async (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const incomingToken = String(req.headers["x-admin-token"] || cookies.betsave_admin_session || "").trim();

    if (!incomingToken) {
        return res.status(401).json({
            status: "FAILED",
            reason: "Missing admin token"
        });
    }

    try {
        const apiTokenHash = hashToken(incomingToken);
        const admin = await Admin.findOne({ apiTokenHash, status: "ACTIVE" })
            .select("_id name email apiTokenIssuedAt");
        if (!admin) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid admin token"
            });
        }

        const issuedAt = admin.apiTokenIssuedAt ? new Date(admin.apiTokenIssuedAt).getTime() : 0;
        const ttlMs = Number(env.ADMIN_TOKEN_TTL_HOURS || 12) * 60 * 60 * 1000;
        if (!issuedAt || Date.now() - issuedAt > ttlMs) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Admin token expired"
            });
        }

        req.admin = {
            id: String(admin._id),
            name: admin.name,
            email: admin.email,
            canManageAdminInvitations: await canAdminManageInvitations(admin._id)
        };

        return next();
    } catch (error) {
        return res.status(500).json({
            status: "FAILED",
            reason: "Admin verification failed"
        });
    }
};
