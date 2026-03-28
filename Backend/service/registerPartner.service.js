import Partner from "../database/models/partner.model.js"
import { generatePartnerCredential } from "./generatePartnerCredentials.service.js";
import { encryptPartnerApiSecret } from "./partnerAuth.service.js";

export const registerPartner = async({ name, webhookUrl, operatingMode = "demo" }) => {
    const existing = await Partner.findOne({ name });
    if(existing){
        throw new Error('Partner already exists.');
    }

    const { apiKey, apiSecret } = generatePartnerCredential(name);
    const partner = await Partner.create({
        name,
        apiKey,
        apiSecretEncrypted: encryptPartnerApiSecret(apiSecret),
        status: 'ACTIVE',
        operatingMode: String(operatingMode || "demo").trim().toLowerCase() === "live" ? "live" : "demo",
        webhookUrl
    });

    return {
        id: partner._id,
        name: partner.name,
        apiKey,
        apiSecret,
        operatingMode: partner.operatingMode,
        webhookUrl: partner.webhookUrl
    };
};
