import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import userRoutes from './route/user.route.js';
import partnerRoutes from './route/partner.route.js';
import partnerAuthRoutes from './route/partnerAuth.route.js';
import partnerDashboardRoutes from './route/partnerDashboard.route.js';
import userDashboardRoutes from './route/userDashboard.route.js';
import adminDashboardRoutes from './route/adminDashboard.route.js';
import adminAuthRoutes from './route/adminAuth.route.js';
import paymentRoutes from './route/payment.route.js';
// config file runs dotenv and validates required env vars
import env from './config.js';
import logger from './logger.js';
import { connectDB, isDatabaseReady } from '../database/config.js';
import { validatePaymentConfiguration } from '../service/validatePaymentConfig.service.js';
import { validatePartnerModeConfiguration } from './middleware/partnerMode.middleware.js';

const PORT = env.PORT;
const app = express();
let server;
const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const terminateProcess = (error, context) => {
    logger.error(`[startup] ${context}`, { error: error?.stack || error?.message || String(error) });
    if (server) {
        server.close(() => process.exit(1));
        return;
    }
    process.exit(1);
};

// handle unexpected errors globally so the process can exit or restart gracefully
process.on('unhandledRejection', (reason) => {
    terminateProcess(reason, 'Unhandled Rejection');
});
process.on('uncaughtException', (err) => {
    terminateProcess(err, 'Uncaught Exception');
});

// security middleware
app.use(helmet());
app.use(express.json());

// CORS handling with whitelist
const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
if (isProduction && corsOrigins.length === 0) {
    throw new Error("CORS_ALLOWED_ORIGINS must be configured in production");
}
const defaultAllowedHeaders = [
    'Content-Type',
    'Authorization',
    'x-api-key',
    'x-signature',
    'x-timestamp',
    'x-user-phone',
    'x-user-token',
    'x-admin-token',
    'x-callback-token',
    'x-integration-token'
];
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowOrigin = origin && corsOrigins.includes(origin);
    if (allowOrigin) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Vary', 'Origin');
    } else if (origin && (isProduction || corsOrigins.length > 0)) {
        return res.status(403).json({
            status: "FAILED",
            reason: "Origin not allowed"
        });
    } else if (origin && !isProduction && corsOrigins.length === 0) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Vary', 'Origin');
    }

    const requestedHeaders = String(req.headers['access-control-request-headers'] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const allowHeaders = [...new Set([...defaultAllowedHeaders, ...requestedHeaders])];

    res.header('Access-Control-Allow-Headers', allowHeaders.join(', '));
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// simple rate limiting for all requests; can be tightened per-route later
const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
        req.path === "/health" ||
        req.path.startsWith("/api/v1/payments/callbacks/")
});
app.use(limiter);

// Base route so platform checks or direct browser visits do not 404 on "/"
app.get('/', (_, res) => {
    res.status(200).json({
        status: 'OK',
        service: 'BETSAVE CORE',
        message: 'Service is running. Use /health for readiness status.',
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', (_, res) => {
    const dbReady = isDatabaseReady();
    res.status(dbReady ? 200 : 503).json({
        status: dbReady ? 'OK' : 'DEGRADED',
        service: 'BETSAVE CORE',
        database: dbReady ? 'UP' : 'DOWN',
        timestamp: new Date().toISOString()
    });
});

// Routes
app.use('/api/v1/register', userRoutes);
app.use('/api/v1/partners', partnerRoutes);
app.use('/api/v1/partners/auth', partnerAuthRoutes);
app.use('/api/v1/dashboard', partnerDashboardRoutes);
app.use('/api/v1/dashboard/partner', partnerDashboardRoutes);
app.use('/api/v1/dashboard/user', userDashboardRoutes);
app.use('/api/v1/dashboard/admin', adminDashboardRoutes);
app.use('/api/v1/admin/auth', adminAuthRoutes);
app.use('/api/v1/payments', paymentRoutes);

// Error handler
app.use((err, req, res, next) => {
    logger.error("Unhandled request error", {
        path: req.originalUrl,
        method: req.method,
        error: err?.stack || err?.message || String(err)
    });
    res.status(500).json({
        error: "Internal Server Error"
    });
});

// Start server
try {
    const partnerModeConfig = validatePartnerModeConfiguration();
    console.log(
        `[startup] Partner mode=${partnerModeConfig.mode} (integrationTokenRequired=${partnerModeConfig.integrationTokenRequired})`
    );

    const paymentConfig = validatePaymentConfiguration();
    if (paymentConfig.depositsEnabled || paymentConfig.withdrawalsEnabled) {
        console.log(
            `[startup] Payments config OK (env=${paymentConfig.env}, deposits=${paymentConfig.depositsEnabled}, withdrawals=${paymentConfig.withdrawalsEnabled})`
        );
    } else {
        console.log("[startup] Payments disabled (both deposits and withdrawals are OFF)");
    }
} catch (error) {
    console.error(`[startup] Payment configuration error: ${error.message}`);
    process.exit(1);
}

connectDB()
    .then(() => {
        server = app.listen(PORT, () => {
            logger.info(`Server running on http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        logger.error('Database connection failed', { error: error.message });
        process.exit(1);
    });
