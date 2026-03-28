import express from 'express';
import Joi from 'joi';
import { validateBody } from '../middleware/validation.middleware.js';
import { registerUser } from '../controller/registration.controller.js';

const router = express.Router();

const registrationSchema = Joi.object({
    phone: Joi.string().pattern(/^\+254\d{9}$/).required()
});

router.post('/', validateBody(registrationSchema), registerUser);

export default router;