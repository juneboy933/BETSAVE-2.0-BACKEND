import test from "node:test";
import assert from "node:assert/strict";

import { validatePaymentConfiguration } from "../service/validatePaymentConfig.service.js";

const originalEnv = {
    DARAJA_ENV: process.env.DARAJA_ENV,
    PAYMENTS_ENABLE_DEPOSITS: process.env.PAYMENTS_ENABLE_DEPOSITS,
    PAYMENTS_ENABLE_WITHDRAWALS: process.env.PAYMENTS_ENABLE_WITHDRAWALS,
    DARAJA_CONSUMER_KEY: process.env.DARAJA_CONSUMER_KEY,
    DARAJA_CONSUMER_SECRET: process.env.DARAJA_CONSUMER_SECRET,
    DARAJA_SHORTCODE: process.env.DARAJA_SHORTCODE,
    DARAJA_PASSKEY: process.env.DARAJA_PASSKEY,
    DARAJA_STK_CALLBACK_URL: process.env.DARAJA_STK_CALLBACK_URL,
    DARAJA_B2C_SHORTCODE: process.env.DARAJA_B2C_SHORTCODE,
    DARAJA_B2C_INITIATOR_NAME: process.env.DARAJA_B2C_INITIATOR_NAME,
    DARAJA_B2C_SECURITY_CREDENTIAL: process.env.DARAJA_B2C_SECURITY_CREDENTIAL,
    DARAJA_B2C_TIMEOUT_URL: process.env.DARAJA_B2C_TIMEOUT_URL,
    DARAJA_B2C_RESULT_URL: process.env.DARAJA_B2C_RESULT_URL,
    PAYMENT_CALLBACK_TOKEN: process.env.PAYMENT_CALLBACK_TOKEN,
    BANK_API_URL: process.env.BANK_API_URL,
    BANK_API_KEY: process.env.BANK_API_KEY,
    BANK_SETTLEMENT_ACCOUNT: process.env.BANK_SETTLEMENT_ACCOUNT
};

const applyBasePaymentEnv = () => {
    process.env.PAYMENTS_ENABLE_DEPOSITS = "true";
    process.env.PAYMENTS_ENABLE_WITHDRAWALS = "true";
    process.env.DARAJA_CONSUMER_KEY = "consumer-key";
    process.env.DARAJA_CONSUMER_SECRET = "consumer-secret";
    process.env.DARAJA_SHORTCODE = "123456";
    process.env.DARAJA_PASSKEY = "passkey";
    process.env.DARAJA_B2C_SHORTCODE = "654321";
    process.env.DARAJA_B2C_INITIATOR_NAME = "betsave";
    process.env.DARAJA_B2C_SECURITY_CREDENTIAL = "credential";
    process.env.PAYMENT_CALLBACK_TOKEN = "callback-token-123";
    process.env.BANK_SETTLEMENT_ACCOUNT = "1234567890";
    delete process.env.BANK_API_URL;
    delete process.env.BANK_API_KEY;
};

test("production payment configuration rejects non-https callback URLs", () => {
    applyBasePaymentEnv();
    process.env.DARAJA_ENV = "production";
    process.env.DARAJA_STK_CALLBACK_URL = "http://example.com/deposit-callback";
    process.env.DARAJA_B2C_TIMEOUT_URL = "https://example.com/timeout";
    process.env.DARAJA_B2C_RESULT_URL = "https://example.com/result";

    assert.throws(
        () => validatePaymentConfiguration(),
        /Production payment callbacks must use HTTPS/
    );
});

test("production payment configuration accepts https callback URLs", () => {
    applyBasePaymentEnv();
    process.env.DARAJA_ENV = "production";
    process.env.DARAJA_STK_CALLBACK_URL = "https://example.com/deposit-callback";
    process.env.DARAJA_B2C_TIMEOUT_URL = "https://example.com/timeout";
    process.env.DARAJA_B2C_RESULT_URL = "https://example.com/result";

    const result = validatePaymentConfiguration();

    assert.equal(result.env, "production");
    assert.equal(result.depositsEnabled, true);
    assert.equal(result.withdrawalsEnabled, true);
});

test("payment configuration requires bank settlement account when deposits are enabled", () => {
    applyBasePaymentEnv();
    process.env.DARAJA_ENV = "sandbox";
    process.env.DARAJA_STK_CALLBACK_URL = "https://example.com/deposit-callback";
    process.env.DARAJA_B2C_TIMEOUT_URL = "https://example.com/timeout";
    process.env.DARAJA_B2C_RESULT_URL = "https://example.com/result";
    delete process.env.BANK_SETTLEMENT_ACCOUNT;

    assert.throws(
        () => validatePaymentConfiguration(),
        /BANK_SETTLEMENT_ACCOUNT is required when deposits are enabled/
    );
});

test("payment configuration requires bank api url and key together", () => {
    applyBasePaymentEnv();
    process.env.DARAJA_ENV = "sandbox";
    process.env.DARAJA_STK_CALLBACK_URL = "https://example.com/deposit-callback";
    process.env.DARAJA_B2C_TIMEOUT_URL = "https://example.com/timeout";
    process.env.DARAJA_B2C_RESULT_URL = "https://example.com/result";
    process.env.BANK_API_URL = "https://bank.example.com/settlement";
    delete process.env.BANK_API_KEY;

    assert.throws(
        () => validatePaymentConfiguration(),
        /BANK_API_URL and BANK_API_KEY must be configured together/
    );
});

test.after(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
        if (value === undefined) {
            delete process.env[key];
            return;
        }
        process.env[key] = value;
    });
});
