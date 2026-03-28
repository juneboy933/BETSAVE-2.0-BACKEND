import test from "node:test";
import assert from "node:assert/strict";

import { evaluateWithdrawalEligibilitySnapshot } from "../service/withdrawalEligibility.service.js";

const NOW = new Date("2026-03-20T12:00:00.000Z");

test("demo withdrawals stay eligible when there is no live wallet activity", () => {
    const result = evaluateWithdrawalEligibilitySnapshot({
        currentBalance: 50,
        hasLiveWalletActivity: false,
        liveAutoSavingsLinks: [],
        now: NOW
    });

    assert.equal(result.operatingMode, "demo");
    assert.equal(result.eligible, true);
    assert.equal(result.denialReason, null);
});

test("live withdrawals are blocked when balance is below the configured threshold", () => {
    const result = evaluateWithdrawalEligibilitySnapshot({
        currentBalance: 80,
        hasLiveWalletActivity: true,
        liveAutoSavingsLinks: [
            {
                partnerId: "507f1f77bcf86cd799439011",
                partnerName: "Partner One",
                status: "ACTIVE",
                autoSavingsEnabledAt: new Date("2025-10-01T00:00:00.000Z")
            }
        ],
        now: NOW,
        liveMinBalanceKes: 100,
        minAutoSavingsDays: 90
    });

    assert.equal(result.operatingMode, "live");
    assert.equal(result.eligible, false);
    assert.match(result.denialReason || "", /wallet balance of at least KES 100/);
});

test("live withdrawals are blocked until auto-savings has matured for the minimum duration", () => {
    const result = evaluateWithdrawalEligibilitySnapshot({
        currentBalance: 500,
        hasLiveWalletActivity: true,
        liveAutoSavingsLinks: [
            {
                partnerId: "507f1f77bcf86cd799439012",
                partnerName: "Partner Two",
                status: "ACTIVE",
                autoSavingsEnabledAt: new Date("2026-02-01T00:00:00.000Z")
            }
        ],
        now: NOW,
        liveMinBalanceKes: 100,
        minAutoSavingsDays: 90
    });

    assert.equal(result.operatingMode, "live");
    assert.equal(result.eligible, false);
    assert.match(result.denialReason || "", /available after 90 days/);
    assert.equal(result.matureLiveAutoSavingsLinkCount, 0);
});

test("live withdrawals are allowed once balance and maturity requirements are met", () => {
    const result = evaluateWithdrawalEligibilitySnapshot({
        currentBalance: 750,
        hasLiveWalletActivity: true,
        liveAutoSavingsLinks: [
            {
                partnerId: "507f1f77bcf86cd799439013",
                partnerName: "Partner Three",
                status: "ACTIVE",
                autoSavingsEnabledAt: new Date("2025-11-15T00:00:00.000Z")
            }
        ],
        now: NOW,
        liveMinBalanceKes: 100,
        minAutoSavingsDays: 90
    });

    assert.equal(result.operatingMode, "live");
    assert.equal(result.eligible, true);
    assert.equal(result.denialReason, null);
    assert.equal(result.matureLiveAutoSavingsLinkCount, 1);
});
