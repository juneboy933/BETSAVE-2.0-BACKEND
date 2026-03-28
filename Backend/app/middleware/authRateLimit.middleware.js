import rateLimit from "express-rate-limit";

const buildAuthLimiter = ({ windowMs, max, message }) =>
    rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            status: "FAILED",
            reason: message
        }
    });

export const adminLoginLimiter = buildAuthLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many admin login attempts. Try again later."
});

export const adminInvitationRegistrationLimiter = buildAuthLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many admin registration attempts. Try again later."
});

export const partnerAuthLimiter = buildAuthLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many partner authentication attempts. Try again later."
});
