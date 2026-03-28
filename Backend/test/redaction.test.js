import test from "node:test";
import assert from "node:assert/strict";

import {
    maskPhoneForDisplay,
    sanitizeStructuredData,
    summarizeUrlForDisplay
} from "../service/redaction.service.js";

test("sanitizeStructuredData redacts sensitive keys recursively", () => {
    const sanitized = sanitizeStructuredData({
        password: "super-secret",
        nested: {
            apiSecret: "abc123",
            providerResponse: {
                token: "danger"
            }
        },
        ok: "value"
    });

    assert.equal(sanitized.password, "[REDACTED]");
    assert.equal(sanitized.nested.apiSecret, "[REDACTED]");
    assert.equal(sanitized.nested.providerResponse, "[REDACTED]");
    assert.equal(sanitized.ok, "value");
});

test("summarizeUrlForDisplay keeps only protocol and host", () => {
    assert.equal(
        summarizeUrlForDisplay("https://partner.example.com/hooks/betsave?token=123"),
        "https://partner.example.com"
    );
});

test("maskPhoneForDisplay shows only final digits", () => {
    assert.equal(maskPhoneForDisplay("+254700123456"), "***456");
});
