import test from "node:test";
import assert from "node:assert/strict";

import {
    buildEventExternalRef,
    buildEventStkIdempotencyKey,
    normalizeOperatingMode,
    parseEventReference
} from "../service/eventReference.service.js";

test("event reference helpers build and parse stable identifiers", () => {
    const externalRef = buildEventExternalRef({
        partnerName: "AcmeBet",
        operatingMode: "live",
        eventId: "BET-123"
    });

    assert.equal(externalRef, "EVENT::AcmeBet::live::BET-123");
    assert.deepEqual(parseEventReference(externalRef), {
        partnerName: "AcmeBet",
        operatingMode: "live",
        eventId: "BET-123"
    });
    assert.equal(
        buildEventStkIdempotencyKey({
            partnerName: "AcmeBet",
            eventId: "BET-123",
            userId: "u1"
        }),
        "event-stk::AcmeBet::BET-123::u1"
    );
});

test("normalizeOperatingMode only accepts supported values", () => {
    assert.equal(normalizeOperatingMode("demo"), "demo");
    assert.equal(normalizeOperatingMode("LIVE"), "live");
    assert.equal(normalizeOperatingMode("production"), null);
    assert.equal(parseEventReference(""), null);
});
