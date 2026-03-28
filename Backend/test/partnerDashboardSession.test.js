import test from "node:test";
import assert from "node:assert/strict";

import { verifyPartnerDashboardSession } from "../app/middleware/partnerDashboardAuth.middleware.js";

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

test("partner dashboard session middleware rejects requests without dashboard session", async () => {
    const req = {
        headers: {
            "x-api-key": "legacy-key",
            "x-signature": "legacy-signature",
            "x-timestamp": String(Date.now())
        }
    };
    const res = createResponse();
    let nextCalled = false;

    await verifyPartnerDashboardSession(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload?.reason, "Partner dashboard session required");
});
