import express from "express";
import {
    createDeposit,
    createWithdrawal,
    getUserPaymentTransactions,
    getPaymentTransactionById,
    handleDepositCallback,
    handleWithdrawalCallback
} from "../controller/payment.controller.js";
import {
    requireAuthenticatedUserOwnership,
    verifyUserToken
} from "../middleware/userAuth.middleware.js";

const router = express.Router();

router.post("/:userId/deposits", verifyUserToken, requireAuthenticatedUserOwnership(), createDeposit);
router.post("/:userId/withdrawals", verifyUserToken, requireAuthenticatedUserOwnership(), createWithdrawal);
router.get("/:userId/transactions", verifyUserToken, requireAuthenticatedUserOwnership(), getUserPaymentTransactions);
router.get("/:userId/transactions/:paymentTransactionId", verifyUserToken, requireAuthenticatedUserOwnership(), getPaymentTransactionById);

router.post("/callbacks/deposit", handleDepositCallback);
router.post("/callbacks/withdrawal", handleWithdrawalCallback);
router.post("/callbacks/b2c/queue", handleWithdrawalCallback);
router.post("/callbacks/b2c/result", handleWithdrawalCallback);

export default router;
