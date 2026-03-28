import Partner from '../database/models/partner.model.js';
import crypto from 'crypto';
import axios from 'axios';
import { resolvePartnerSigningSecret } from './partnerSecret.service.js';
import { recordOperationalLogSafe } from './operationalLog.service.js';

export const sendpartnerWebhook = async ({ partnerName, payload }) => {
    try {
        const partner = await Partner.findOne({ name: partnerName })
            .select("+apiSecret +apiSecretEncrypted name apiKey webhookUrl");
        if (!partner?.webhookUrl) {
            await recordOperationalLogSafe({
                category: "WEBHOOK",
                action: "PARTNER_WEBHOOK_SKIPPED",
                level: "WARN",
                status: "SKIPPED",
                message: `No webhook configured for partner ${partnerName}`,
                targetType: "PARTNER",
                targetId: partnerName,
                partnerName,
                metadata: payload
            });
            return console.warn(`No webhook configured for partner ${partnerName}`);
        }

        const signingSecret = resolvePartnerSigningSecret(partner);
        if (!signingSecret) {
            throw new Error(`Partner signing secret is unavailable for ${partnerName}`);
        }

        const timestamp = Date.now().toString();
        const signaturePayload = `${timestamp}${JSON.stringify(payload)}`;
        const signature = crypto.createHmac("sha256", signingSecret).update(signaturePayload).digest('hex');

        await axios.post(partner.webhookUrl, payload, {
            headers: {
                "Content-Type": "application/json",
                "x-timestamp": timestamp,
                "x-signature": signature,
                "x-api-key": partner.apiKey
            },
            timeout: Number(process.env.PARTNER_WEBHOOK_TIMEOUT_MS || 5000)
        });

        await recordOperationalLogSafe({
            category: "WEBHOOK",
            action: "PARTNER_WEBHOOK_SENT",
            level: "INFO",
            status: "SUCCESS",
            message: `Webhook delivered to partner ${partner.name}`,
            targetType: "PARTNER",
            targetId: String(partner._id),
            partnerName: partner.name,
            metadata: {
                webhookUrl: partner.webhookUrl,
                payload
            }
        });
        console.log(`Webhook sent to ${partner.name} successfully`);

    } catch (error) {
        await recordOperationalLogSafe({
            category: "WEBHOOK",
            action: "PARTNER_WEBHOOK_FAILED",
            level: "ERROR",
            status: "FAILED",
            message: `Webhook failed for partner ${partnerName}: ${error.message}`,
            targetType: "PARTNER",
            targetId: partnerName,
            partnerName,
            metadata: {
                error: error.message,
                payload
            }
        });
        console.error(`Webhook failed for partner ${partnerName}:`, error.message);
        throw error;
    }
};
