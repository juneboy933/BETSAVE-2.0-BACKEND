import test from "node:test";
import assert from "node:assert/strict";

import {
    runInTransaction,
    runRequiredTransaction,
    setTransactionSupport,
    supportsTransactions
} from "../service/databaseSession.service.js";

test("runInTransaction falls back cleanly when transactions are unavailable", async () => {
    setTransactionSupport(false);

    const result = await runInTransaction(async (session) => {
        assert.equal(session, null);
        return "ok";
    }, { label: "unit-test-fallback" });

    assert.equal(result, "ok");
    assert.equal(supportsTransactions(), false);
});

test("runInTransaction can reject fallback when transactions are required", async () => {
    setTransactionSupport(false);

    await assert.rejects(
        () => runInTransaction(async () => "nope", {
            label: "unit-test-required",
            allowFallback: false
        }),
        /transactions are required/i
    );
});

test("runRequiredTransaction always rejects when transactions are unavailable", async () => {
    setTransactionSupport(false);

    await assert.rejects(
        () => runRequiredTransaction(async () => "nope", {
            label: "unit-test-required-helper"
        }),
        /transactions are required/i
    );
});
