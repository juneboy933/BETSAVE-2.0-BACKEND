import test from "node:test";
import assert from "node:assert/strict";

const ensureEnv = () => {
    process.env.PORT = process.env.PORT || "5000";
    process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/betsave";
    process.env.REDIS_URI = process.env.REDIS_URI || "redis://localhost:6379";
    process.env.USER_JWT_SECRET =
        process.env.USER_JWT_SECRET || "12345678901234567890123456789012";
    process.env.PARTNER_JWT_SECRET =
        process.env.PARTNER_JWT_SECRET || "abcdefghijklmnopqrstuvwxyz123456";
    process.env.PARTNER_SECRET_ENCRYPTION_KEY =
        process.env.PARTNER_SECRET_ENCRYPTION_KEY ||
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
};

test("partner secret helper resolves encrypted and legacy secrets", async () => {
    ensureEnv();

    const { encryptPartnerApiSecret } = await import("../service/partnerAuth.service.js");
    const { resolvePartnerSigningSecret } = await import("../service/partnerSecret.service.js");

    const plainSecret = "partner-secret-value";
    const encryptedSecret = encryptPartnerApiSecret(plainSecret);

    assert.equal(resolvePartnerSigningSecret({ apiSecretEncrypted: encryptedSecret }), plainSecret);
    assert.equal(resolvePartnerSigningSecret({ apiSecret: plainSecret }), plainSecret);
    assert.equal(resolvePartnerSigningSecret({}), "");
});
