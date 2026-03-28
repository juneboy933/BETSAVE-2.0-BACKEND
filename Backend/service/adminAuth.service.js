import crypto from "crypto";

export const hashPassword = (password, salt) =>
    crypto.scryptSync(password, salt, 64).toString("hex");

export const generateSalt = () => crypto.randomBytes(16).toString("hex");

export const generateAdminToken = () => crypto.randomBytes(48).toString("hex");

export const generateInvitationCode = () => {
    // Generate a URL-safe, time-limited code for admin invitations
    return crypto.randomBytes(32).toString("hex");
};

export const hashToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

export const buildInvitationCodePreview = (code) => {
    const normalizedCode = String(code || "").trim();
    if (normalizedCode.length <= 12) {
        return normalizedCode;
    }

    return `${normalizedCode.slice(0, 6)}...${normalizedCode.slice(-4)}`;
};
