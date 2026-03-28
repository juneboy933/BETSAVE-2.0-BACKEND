import test from "node:test";
import assert from "node:assert/strict";

import { deriveEffectiveEventState } from "../service/eventStatus.service.js";

test("successful payment resolves processing event as processed", () => {
    const result = deriveEffectiveEventState({
        event: { status: "PROCESSING" },
        paymentTransaction: { status: "SUCCESS" }
    });

    assert.equal(result.effectiveStatus, "PROCESSED");
    assert.equal(result.shouldFinalize, true);
    assert.equal(result.paymentStatus, "SUCCESS");
});

test("failed payment resolves processing event as failed", () => {
    const result = deriveEffectiveEventState({
        event: { status: "PROCESSING", failureReason: null },
        paymentTransaction: { status: "FAILED", failureReason: "Insufficient funds" }
    });

    assert.equal(result.effectiveStatus, "FAILED");
    assert.equal(result.shouldFinalize, true);
    assert.equal(result.statusReason, "Insufficient funds");
});

test("pending payment keeps event in processing", () => {
    const result = deriveEffectiveEventState({
        event: { status: "RECEIVED" },
        paymentTransaction: { status: "PENDING" }
    });

    assert.equal(result.effectiveStatus, "PROCESSING");
    assert.equal(result.shouldFinalize, false);
});
