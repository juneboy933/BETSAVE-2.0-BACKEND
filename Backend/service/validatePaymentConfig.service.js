import dotenv from "dotenv";

dotenv.config();

const getEnv = (key) => String(process.env[key] || "").trim();
const isHttpsUrl = (value) => /^https:\/\//i.test(String(value || "").trim());

const parseBoolean = (value, defaultValue = true) => {
    if (value === undefined || value === null || String(value).trim() === "") {
        return defaultValue;
    }

    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return defaultValue;
};

export const validatePaymentConfiguration = () => {
    const depositsEnabled = parseBoolean(process.env.PAYMENTS_ENABLE_DEPOSITS, true);
    const withdrawalsEnabled = parseBoolean(process.env.PAYMENTS_ENABLE_WITHDRAWALS, true);

    if (!depositsEnabled && !withdrawalsEnabled) {
        return {
            env: null,
            depositsEnabled,
            withdrawalsEnabled
        };
    }

    const envRaw = getEnv("DARAJA_ENV").toLowerCase() || "sandbox";
    const env = envRaw === "live" ? "production" : envRaw;
    if (!["sandbox", "production"].includes(env)) {
        throw new Error("Invalid DARAJA_ENV. Use 'sandbox' or 'production'.");
    }

    const required = [
        "DARAJA_CONSUMER_KEY",
        "DARAJA_CONSUMER_SECRET"
    ];

    if (depositsEnabled) {
        required.push(
            "DARAJA_SHORTCODE",
            "DARAJA_PASSKEY",
            "DARAJA_STK_CALLBACK_URL"
        );
    }

    if (withdrawalsEnabled) {
        required.push(
            "DARAJA_B2C_SHORTCODE",
            "DARAJA_B2C_INITIATOR_NAME",
            "DARAJA_B2C_SECURITY_CREDENTIAL",
            "DARAJA_B2C_TIMEOUT_URL",
            "DARAJA_B2C_RESULT_URL"
        );
    }

    const missing = [...new Set(required)].filter((key) => !getEnv(key));
    if (missing.length > 0) {
        throw new Error(`Missing required payment env vars: ${missing.join(", ")}`);
    }

    if (!getEnv("PAYMENT_CALLBACK_TOKEN")) {
        throw new Error("PAYMENT_CALLBACK_TOKEN is required when payments are enabled");
    }

    const bankApiUrlConfigured = Boolean(getEnv("BANK_API_URL"));
    const bankApiKeyConfigured = Boolean(getEnv("BANK_API_KEY"));
    if (bankApiUrlConfigured !== bankApiKeyConfigured) {
        throw new Error("BANK_API_URL and BANK_API_KEY must be configured together");
    }

    if (depositsEnabled && !getEnv("BANK_SETTLEMENT_ACCOUNT")) {
        throw new Error("BANK_SETTLEMENT_ACCOUNT is required when deposits are enabled");
    }

    if (env === "production") {
        const productionUrls = [
            depositsEnabled ? "DARAJA_STK_CALLBACK_URL" : null,
            withdrawalsEnabled ? "DARAJA_B2C_TIMEOUT_URL" : null,
            withdrawalsEnabled ? "DARAJA_B2C_RESULT_URL" : null
        ].filter(Boolean);

        const insecureUrls = productionUrls.filter((key) => !isHttpsUrl(getEnv(key)));
        if (insecureUrls.length) {
            throw new Error(`Production payment callbacks must use HTTPS: ${insecureUrls.join(", ")}`);
        }
    }

    return {
        env,
        depositsEnabled,
        withdrawalsEnabled
    };
};
