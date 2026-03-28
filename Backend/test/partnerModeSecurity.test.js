import test from "node:test";
import assert from "node:assert/strict";

import { requirePartnerIntegrationInLiveMode } from "../app/middleware/partnerMode.middleware.js";

const originalIntegrationToken = process.env.PARTNER_INTEGRATION_TOKEN;

const createResponse = () => ({
    statusCode: 200,
    payload: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.payload = body;
        return this;
    }
});

test("live partner writes reject dashboard-session authentication", async () => {
    process.env.PARTNER_INTEGRATION_TOKEN = "super-secret-live-token";

    const req = {
        partner: {
            operatingMode: "live"
        },
        partnerAuthMethod: "dashboard-session",
        headers: {}
    };
    const res = createResponse();
    let nextCalled = false;

    requirePartnerIntegrationInLiveMode(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(
        res.payload?.reason,
        "Live write actions require signed server-to-server integration authentication"
    );
});

test("live partner writes allow signed integration requests with valid token", async () => {
    process.env.PARTNER_INTEGRATION_TOKEN = "super-secret-live-token";

    const req = {
        partner: {
            operatingMode: "live"
        },
        partnerAuthMethod: "signature",
        headers: {
            "x-integration-token": "super-secret-live-token"
        }
    };
    const res = createResponse();
    let nextCalled = false;

    requirePartnerIntegrationInLiveMode(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.payload, null);
});

test.after(() => {
    process.env.PARTNER_INTEGRATION_TOKEN = originalIntegrationToken;
});
