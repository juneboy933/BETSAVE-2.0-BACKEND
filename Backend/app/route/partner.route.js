import express from 'express';
import Joi from 'joi';
import { validateBody } from '../middleware/validation.middleware.js';
import {
    getPartnerOperatingMode,
    registerUserFromPartner,
    setPartnerOperatingMode,
    verifyPartnerUserOtp
} from '../controller/partner.controller.js';
import { createPartnerWithdrawal } from "../controller/payment.controller.js";
import { verifyPartnerDashboard, verifyPartnerDashboardSession } from '../middleware/partnerDashboardAuth.middleware.js';
import { requirePartnerIntegrationInLiveMode } from '../middleware/partnerMode.middleware.js';
import { postEvent } from '../controller/event.controller.js';

const router = express.Router();

router.get('/mode', verifyPartnerDashboardSession, getPartnerOperatingMode);
router.patch('/mode', verifyPartnerDashboardSession, setPartnerOperatingMode);
const eventSchema = Joi.object({
    eventId: Joi.string().required(),
    phone: Joi.string().pattern(/^\+254\d{9}$/).required(),
    amount: Joi.number().positive().required(),
    type: Joi.string().valid("BET_PLACED").default("BET_PLACED")
});

const newPartnerUserSchema = Joi.object({
    phone: Joi.string().pattern(/^\+254\d{9}$/).required(),
    autoSavingsEnabled: Joi.boolean().optional()
});

const verifyPartnerOtpSchema = Joi.object({
    phone: Joi.string().pattern(/^\+254\d{9}$/).required(),
    otp: Joi.string().min(4).max(6).required()
});

const partnerWithdrawalSchema = Joi.object({
    phone: Joi.string().pattern(/^\+254\d{9}$/).allow("", null),
    amount: Joi.number().positive().required(),
    idempotencyKey: Joi.string().trim().required(),
    notes: Joi.string().max(300).allow("", null)
});

router.post(
    '/events',
    verifyPartnerDashboard,
    requirePartnerIntegrationInLiveMode,
    validateBody(eventSchema),
    postEvent
);
router.post(
    '/users/register',
    verifyPartnerDashboard,
    requirePartnerIntegrationInLiveMode,
    validateBody(newPartnerUserSchema),
    registerUserFromPartner
);
router.post(
    '/users/verify-otp',
    verifyPartnerDashboard,
    requirePartnerIntegrationInLiveMode,
    validateBody(verifyPartnerOtpSchema),
    verifyPartnerUserOtp
);
router.post(
    '/users/:userId/withdrawals',
    verifyPartnerDashboard,
    requirePartnerIntegrationInLiveMode,
    validateBody(partnerWithdrawalSchema),
    createPartnerWithdrawal
);

export default router;
