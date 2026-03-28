import express from "express";
import Joi from "joi";
import { validateBody } from "../middleware/validation.middleware.js";
import {
    registerPartnerAuth,
    loginPartnerAuth,
    logoutPartnerAuth,
    refreshPartnerToken
} from "../controller/partnerAuth.controller.js";
import { partnerAuthLimiter } from "../middleware/authRateLimit.middleware.js";
import { verifyPartnerDashboard } from "../middleware/partnerDashboardAuth.middleware.js";

const router = express.Router();

const registrationSchema = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(10).required(),
    webhookUrl: Joi.string().uri().allow("", null),
    operatingMode: Joi.string().valid("demo", "live").default("demo")
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
});

router.post("/register", partnerAuthLimiter, validateBody(registrationSchema), registerPartnerAuth);
router.post("/login", partnerAuthLimiter, validateBody(loginSchema), loginPartnerAuth);
router.post("/refresh", refreshPartnerToken);
router.post("/logout", verifyPartnerDashboard, logoutPartnerAuth);

export default router;
