import { createLogger, format, transports } from 'winston';
import { sanitizeLogMetadata } from "../service/redaction.service.js";

// simple console logger with timestamp and level
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.printf(({ timestamp, level, message, ...meta }) => {
            let msg = `${timestamp} [${level.toUpperCase()}] ${message}`;
            const safeMeta = sanitizeLogMetadata(meta);
            if (Object.keys(safeMeta || {}).length) {
                msg += ` ${JSON.stringify(safeMeta)}`;
            }
            return msg;
        })
    ),
    transports: [new transports.Console()]
});

export default logger;
