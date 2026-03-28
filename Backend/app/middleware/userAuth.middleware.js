import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../../database/models/user.model.js";
import env from "../config.js";

/**
 * Replaces the insecure phone-header based auth with JWTs.
 * Clients must send `x-user-token: <jwt>` on protected routes.
 * The token payload is expected to contain `userId` and `phoneNumber`.
 */
export const verifyUserToken = async (req, res, next) => {
    try {
        const token = req.headers["x-user-token"];
        if (!token || typeof token !== "string") {
            return res.status(401).json({
                status: "FAILED",
                reason: "Missing authentication token"
            });
        }

        let payload;
        try {
            payload = jwt.verify(token, env.USER_JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Invalid or expired token"
            });
        }

        const { userId, phoneNumber } = payload;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(401).json({
                status: "FAILED",
                reason: "Token contains invalid user id"
            });
        }

        const user = await User.findById(userId).select("phoneNumber");
        if (!user) {
            return res.status(404).json({
                status: "FAILED",
                reason: "User not found"
            });
        }

        if (user.phoneNumber !== phoneNumber) {
            // token was forged or user changed phone
            return res.status(403).json({
                status: "FAILED",
                reason: "User access denied"
            });
        }

        req.user = {
            id: user._id.toString(),
            phoneNumber: user.phoneNumber
        };
        next();
    } catch (error) {
        console.error("verifyUserToken error:", error.message);
        return res.status(500).json({
            status: "FAILED",
            reason: "User verification failed"
        });
    }
};

export const requireAuthenticatedUserOwnership = (paramName = "userId") => (req, res, next) => {
    const resourceUserId = String(req.params?.[paramName] || "").trim();
    if (!resourceUserId) {
        return res.status(400).json({
            status: "FAILED",
            reason: "Missing user id"
        });
    }

    if (resourceUserId !== String(req.user?.id || "").trim()) {
        return res.status(403).json({
            status: "FAILED",
            reason: "User access denied"
        });
    }

    return next();
};
