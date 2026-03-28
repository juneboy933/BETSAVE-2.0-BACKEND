import { decryptPartnerApiSecret } from "./partnerAuth.service.js";

export const resolvePartnerSigningSecret = (partner) => {
    const encryptedSecret = String(partner?.apiSecretEncrypted || "").trim();
    if (encryptedSecret) {
        return decryptPartnerApiSecret(encryptedSecret);
    }

    return String(partner?.apiSecret || "").trim();
};
