const SENSITIVE_KEY_REGEX = /(pass(word|key)?|secret|token|authorization|cookie|signature|credential|api.?key|api.?secret|rawcallback|providerresponse|set-cookie|otp|salt|hash)/i;
const MAX_DEPTH = 4;
const MAX_KEYS = 25;
const MAX_ARRAY_ITEMS = 10;
const MAX_STRING_LENGTH = 240;

const truncateString = (value) => {
    const normalized = String(value || "");
    if (normalized.length <= MAX_STRING_LENGTH) {
        return normalized;
    }
    return `${normalized.slice(0, MAX_STRING_LENGTH)}...`;
};

export const sanitizeStructuredData = (value, depth = 0) => {
    if (value === null || value === undefined) {
        return value;
    }

    if (depth >= MAX_DEPTH) {
        return "[TRUNCATED]";
    }

    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeStructuredData(item, depth + 1));
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === "string") {
        return truncateString(value);
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return value;
    }

    if (typeof value !== "object") {
        return truncateString(value);
    }

    const entries = Object.entries(value).slice(0, MAX_KEYS).map(([key, entryValue]) => {
        if (SENSITIVE_KEY_REGEX.test(key)) {
            return [key, "[REDACTED]"];
        }

        return [key, sanitizeStructuredData(entryValue, depth + 1)];
    });

    return Object.fromEntries(entries);
};

export const sanitizeLogMetadata = (value) => sanitizeStructuredData(value);

export const summarizeUrlForDisplay = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return null;
    }

    try {
        const url = new URL(normalized);
        return `${url.protocol}//${url.host}`;
    } catch {
        return truncateString(normalized);
    }
};

export const maskPhoneForDisplay = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return "";
    }

    const digits = normalized.replace(/\D/g, "");
    if (digits.length < 4) {
        return normalized;
    }

    const suffix = digits.slice(-3);
    return `***${suffix}`;
};
