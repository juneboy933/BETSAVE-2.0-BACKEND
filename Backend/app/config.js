import Joi from 'joi';
import dotenv from 'dotenv';

// load .env at project root if present
dotenv.config();

const envSchema = Joi.object({
    PORT: Joi.number().integer().min(1).max(65535).required(),
    MONGO_URI: Joi.string().uri().required(),
    MONGO_REQUIRE_TRANSACTIONS: Joi.boolean().truthy("true", "1", "yes", "on").falsy("false", "0", "no", "off").default(false),
    REDIS_URI: Joi.string().uri().required(),

    // optional operational settings
    SAVINGS_PERCENTAGE: Joi.number().min(0).max(1).default(0.1),

    ADMIN_DASHBOARD_TOKEN: Joi.string().min(10).allow("", null),
    ADMIN_TOKEN_TTL_HOURS: Joi.number().integer().min(1).max(168).default(12),
    PARTNER_OPERATING_MODE: Joi.string().valid('demo','live').default('demo'),
    PARTNER_INTEGRATION_TOKEN: Joi.string().min(10).allow('', null),
    PARTNER_JWT_SECRET: Joi.string().min(32).required(),
    PARTNER_SECRET_ENCRYPTION_KEY: Joi.string().pattern(/^[a-fA-F0-9]{64}$/).required(),

    // CORS origins whitelist (comma-separated)
    CORS_ALLOWED_ORIGINS: Joi.string().allow('').default(''),

    // user authentication
    USER_JWT_SECRET: Joi.string().min(32).required(),
    USER_JWT_EXPIRATION: Joi.string().default('7d'),
    USER_SELF_REGISTRATION_ENABLED: Joi.boolean().truthy("true", "1", "yes", "on").falsy("false", "0", "no", "off").default(false),


    // external services
    BANK_API_URL: Joi.string().uri().allow('', null),
    BANK_API_KEY: Joi.string().allow('', null),
    BANK_SETTLEMENT_ACCOUNT: Joi.string().allow('', null),
    PAYMENT_CALLBACK_TOKEN: Joi.string().min(8).allow('', null),
    PARTNER_WEBHOOK_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000),
    OPERATIONAL_RECOVERY_INTERVAL_MS: Joi.number().integer().min(5000).default(60000),
    RECOVERY_BATCH_SIZE: Joi.number().integer().min(1).max(1000).default(100),
    STALE_PROCESSING_EVENT_MS: Joi.number().integer().min(1000).default(10 * 60 * 1000),
    STALE_INITIATED_PAYMENT_MS: Joi.number().integer().min(1000).default(5 * 60 * 1000),
    STALE_PENDING_PAYMENT_MS: Joi.number().integer().min(1000).default(30 * 60 * 1000),
    STALE_SETTLEMENT_MS: Joi.number().integer().min(1000).default(24 * 60 * 60 * 1000),
    RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: Joi.number().integer().min(1).default(200),
    LIVE_WITHDRAWAL_MIN_BALANCE_KES: Joi.number().min(0).default(100),
    LIVE_WITHDRAWAL_MIN_AUTOSAVINGS_DAYS: Joi.number().integer().min(1).default(90),

    DARAJA_ENV: Joi.string().valid('sandbox','production').default('sandbox'),
    DARAJA_HTTP_TIMEOUT_MS: Joi.number().integer().min(1000).default(20000),

    // redis auth
    REDIS_PASSWORD: Joi.string().allow('', null)
}).unknown(); // allow other vars

const { value: env, error } = envSchema.validate(process.env, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true
});

if (error) {
    console.error('Environment validation error:', error.details.map(d => d.message).join(', '));
    process.exit(1);
}

export default env;
