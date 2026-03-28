import crypto from "crypto";
import jwt from "jsonwebtoken";
import env from "../app/config.js";

const HASH_ALGORITHM = "sha256";
const HASH_KEY_LENGTH = 32;

export const generateSalt = () => crypto.randomBytes(16).toString("hex");

export const hashPassword = (password, salt) => {
    return crypto
        .pbkdf2Sync(password, salt, 100000, HASH_KEY_LENGTH, HASH_ALGORITHM)
        .toString("hex");
};

const PARTNER_SECRET_KEY = Buffer.from(env.PARTNER_SECRET_ENCRYPTION_KEY, "hex");

export const generatePartnerJWT = (partnerId, email, partnerName) => {
    return jwt.sign(
        {
            partnerId: partnerId.toString(),
            email,
            name: partnerName
        },
        env.PARTNER_JWT_SECRET,
        { expiresIn: "8h" }
    );
};

export const encryptPartnerApiSecret = (apiSecret) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", PARTNER_SECRET_KEY, iv);
    const encrypted = Buffer.concat([
        cipher.update(String(apiSecret || ""), "utf8"),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const decryptPartnerApiSecret = (payload) => {
    const [ivHex, tagHex, encryptedHex] = String(payload || "").split(":");
    if (!ivHex || !tagHex || !encryptedHex) {
        return "";
    }

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        PARTNER_SECRET_KEY,
        Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, "hex")),
        decipher.final()
    ]).toString("utf8");
};

export const verifyPartnerJWT = (token) => {
    try {
        return jwt.verify(token, env.PARTNER_JWT_SECRET);
    } catch (err) {
        return null;
    }
};
