import express from "express";
import {
    getUserDashboardSummary,
    getUserEvents,
    getUserTransactions
} from "../controller/userDashboard.controller.js";
import {
    requireAuthenticatedUserOwnership,
    verifyUserToken
} from "../middleware/userAuth.middleware.js";

const router = express.Router();

router.get("/:userId", verifyUserToken, requireAuthenticatedUserOwnership(), getUserDashboardSummary);
router.get("/:userId/events", verifyUserToken, requireAuthenticatedUserOwnership(), getUserEvents);
router.get("/:userId/transactions", verifyUserToken, requireAuthenticatedUserOwnership(), getUserTransactions);

export default router;
