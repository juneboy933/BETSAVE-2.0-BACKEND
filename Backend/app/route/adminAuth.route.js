import express from "express";
import {
    createAdminInvitation,
    getAdminSession,
    listAdminInvitations,
    loginAdmin,
    logoutAdmin,
    registerAdminWithInvitation,
    revokeAdminInvitation
} from "../controller/adminAuth.controller.js";
import { verifyAdmin } from "../middleware/adminAuth.middleware.js";
import {
    adminInvitationRegistrationLimiter,
    adminLoginLimiter
} from "../middleware/authRateLimit.middleware.js";

const router = express.Router();

// Public routes (no protection)
router.post("/login", adminLoginLimiter, loginAdmin);
router.post("/register-with-invitation", adminInvitationRegistrationLimiter, registerAdminWithInvitation);
router.get("/session", verifyAdmin, getAdminSession);
router.post("/logout", verifyAdmin, logoutAdmin);

// Admin-only routes (require valid admin token)
router.post("/invitations", verifyAdmin, createAdminInvitation);
router.get("/invitations", verifyAdmin, listAdminInvitations);
router.delete("/invitations/:invitationId", verifyAdmin, revokeAdminInvitation);

export default router;
