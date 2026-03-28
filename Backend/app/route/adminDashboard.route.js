import express from "express";
import {
    activateUser,
    getAdminPartnerDetails,
    getAdminNotificationSummary,
    getAdminOverview,
    getAdminPartners,
    getAdminUserSavingsBreakdown,
    getAdminUsers,
    getAdminEvents,
    getAdminNotifications,
    getAdminSavings,
    getAdminOperations,
    runAdminSettlementReconciliation,
    markAdminNotificationsRead,
    suspendUser,
    updatePartnerStatus
} from "../controller/adminDashboard.controller.js";
import { verifyAdmin } from "../middleware/adminAuth.middleware.js";

const router = express.Router();

router.use(verifyAdmin);
router.get("/overview", getAdminOverview);
router.get("/partners", getAdminPartners);
router.get("/partners/:partnerId/details", getAdminPartnerDetails);
router.get("/users", getAdminUsers);
router.get("/users/:userId/savings-breakdown", getAdminUserSavingsBreakdown);
router.get("/events", getAdminEvents);
router.get("/notifications", getAdminNotifications);
router.get("/notifications/summary", getAdminNotificationSummary);
router.patch("/notifications/read-all", markAdminNotificationsRead);
router.get("/savings", getAdminSavings);
router.get("/operations", getAdminOperations);
router.post("/operations/reconciliation-runs", runAdminSettlementReconciliation);
router.patch("/partners/:partnerId/status", updatePartnerStatus);
router.patch("/users/:userId/suspend", suspendUser);
router.patch("/users/:userId/activate", activateUser);

export default router;
