import crypto from 'crypto';

export const generatePartnerCredential = (name) => {
    const safeName = name.replace(/\s+/g, "_").toUpperCase();

    const apiKey = `${safeName}_${crypto.randomBytes(8).toString("hex")}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');

    return { apiKey, apiSecret };
};