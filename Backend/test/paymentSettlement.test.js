import test from "node:test";
import assert from "node:assert/strict";

import PaymentTransaction from "../database/models/paymentTransaction.model.js";
import {
    classifySettlementCandidate,
    deriveDepositSettlementStatus,
    normalizeSettlementEntry
} from "../service/paymentSettlement.service.js";

test("deposit transactions default to pending settlement while withdrawals do not", () => {
    const deposit = new PaymentTransaction({
        type: "DEPOSIT",
        channel: "STK",
        status: "SUCCESS",
        userId: "507f191e810c19729de860ea",
        phone: "+254700000001",
        amount: 100,
        currency: "KES",
        idempotencyKey: "dep-1"
    });
    const withdrawal = new PaymentTransaction({
        type: "WITHDRAWAL",
        channel: "B2C",
        status: "PENDING",
        userId: "507f191e810c19729de860eb",
        phone: "+254700000002",
        amount: 100,
        currency: "KES",
        idempotencyKey: "wd-1"
    });

    assert.equal(deposit.settlementStatus, "PENDING");
    assert.equal(withdrawal.settlementStatus, "NOT_APPLICABLE");
});

test("demo deposits are marked as not applicable for real settlement", () => {
    const status = deriveDepositSettlementStatus({
        externalRef: "EVENT::demo::partner-one::EVT-123",
        applyWalletCredit: false
    });

    assert.equal(status, "NOT_APPLICABLE");
});

test("normalizeSettlementEntry rejects entries without identifiers", () => {
    assert.throws(
        () => normalizeSettlementEntry({ amount: 100 }, 0),
        /must include providerTransactionId, providerRequestId, or externalRef/
    );
});

test("classifySettlementCandidate flags amount mismatch", () => {
    const result = classifySettlementCandidate({
        paymentTransaction: {
            _id: "tx-1",
            type: "DEPOSIT",
            status: "SUCCESS",
            amount: 100,
            externalRef: "EVENT::live::partner-one::EVT-123",
            settlementStatus: "PENDING"
        },
        settlementEntry: {
            amount: 150,
            providerTransactionId: "R123"
        }
    });

    assert.equal(result.outcome, "AMOUNT_MISMATCH");
    assert.match(result.discrepancy?.notes || "", /does not match/);
});
