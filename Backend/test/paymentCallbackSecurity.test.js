import test from "node:test";
import assert from "node:assert/strict";

import {
    buildSignedCallbackToken,
    buildSignedCallbackUrl,
    verifySignedCallbackToken
} from "../service/paymentCallbackSecurity.service.js";

test("buildSignedCallbackToken and verifySignedCallbackToken agree for deposits", () => {
    process.env.PAYMENT_CALLBACK_TOKEN =
        process.env.PAYMENT_CALLBACK_TOKEN || "12345678901234567890123456789012";

    const token = buildSignedCallbackToken({
        callbackType: "deposit",
        resourceId: "507f1f77bcf86cd799439011"
    });

    assert.equal(
        verifySignedCallbackToken({
            callbackType: "deposit",
            resourceId: "507f1f77bcf86cd799439011",
            providedToken: token
        }),
        true
    );
});

test("verifySignedCallbackToken rejects mismatched resource ids", () => {
    process.env.PAYMENT_CALLBACK_TOKEN =
        process.env.PAYMENT_CALLBACK_TOKEN || "12345678901234567890123456789012";

    const token = buildSignedCallbackToken({
        callbackType: "withdrawal",
        resourceId: "507f1f77bcf86cd799439012"
    });

    assert.equal(
        verifySignedCallbackToken({
            callbackType: "withdrawal",
            resourceId: "507f1f77bcf86cd799439013",
            providedToken: token
        }),
        false
    );
});

test("buildSignedCallbackUrl encodes callback type and resource id", () => {
    process.env.PAYMENT_CALLBACK_TOKEN =
        process.env.PAYMENT_CALLBACK_TOKEN || "12345678901234567890123456789012";

    const callbackUrl = buildSignedCallbackUrl({
        baseUrl: "https://example.com/api/v1/payments/callbacks/deposit",
        callbackType: "deposit",
        resourceId: "507f1f77bcf86cd799439014"
    });

    const parsed = new URL(callbackUrl);

    assert.equal(parsed.searchParams.get("callbackType"), "deposit");
    assert.equal(parsed.searchParams.get("paymentTransactionId"), "507f1f77bcf86cd799439014");
    assert.ok(parsed.searchParams.get("callbackToken"));
});
