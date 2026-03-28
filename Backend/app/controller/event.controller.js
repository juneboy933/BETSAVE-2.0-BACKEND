import { ingestEvent } from "../../service/ingestEvent.service.js";
import { eventQueue } from "../../worker/queues.js";
import { recordOperationalLogSafe } from "../../service/operationalLog.service.js";

export const postEvent = async (req, res) => {
    try {
        const { eventId, phone, amount, type } = req.body;

        if (!req.partner) return res.status(401).json({ status: "FAILED", reason: "Partner not authenticated" });

        const partnerName = req.partner.name;
        const normalizedType = String(type || "BET_PLACED").trim().toUpperCase();

        // Validation
        if (!eventId || !phone || amount === undefined) return res.status(400).json({ status: 'FAILED', reason: 'Event Id, phone or amount missing' });
        if (typeof amount !== "number" || amount <= 0) return res.status(400).json({ status: 'FAILED', reason: 'Invalid amount' });
        if (normalizedType !== "BET_PLACED") {
            return res.status(400).json({ status: "FAILED", reason: "Only BET_PLACED events are supported" });
        }

        const ingestResult = await ingestEvent({ eventId, phone, partnerName, type: normalizedType, amount });

        if (ingestResult.status === 'FAILED') {
            await recordOperationalLogSafe({
                category: "EVENT",
                action: "PARTNER_EVENT_FAILED_VALIDATION",
                level: "WARN",
                status: "FAILED",
                message: `Rejected BET_PLACED event ${eventId} from partner ${partnerName}: ${ingestResult.reason}`,
                targetType: "EVENT",
                targetId: eventId,
                partnerName,
                operatingMode: req.partner?.operatingMode || null,
                eventId,
                metadata: {
                    amount,
                    phone,
                    reason: ingestResult.reason
                }
            });
            return res.status(400).json(ingestResult);
        }
        if (ingestResult.status === 'SKIPPED') {
            await recordOperationalLogSafe({
                category: "EVENT",
                action: "PARTNER_EVENT_SKIPPED",
                level: "WARN",
                status: "SKIPPED",
                message: `Skipped duplicate BET_PLACED event ${eventId} from partner ${partnerName}`,
                targetType: "EVENT",
                targetId: eventId,
                partnerName,
                operatingMode: req.partner?.operatingMode || null,
                eventId
            });
            return res.status(200).json(ingestResult);
        }

        const operatingMode = String(ingestResult?.event?.operatingMode || req.partner?.operatingMode || "demo")
            .trim()
            .toLowerCase() === "live"
            ? "live"
            : "demo";

        // Queue the event
        await eventQueue.add('process-event', 
            { eventId, partnerName, operatingMode },
            {
                jobId: `${partnerName}-${operatingMode}-${eventId}`,
                attempts: 5,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: true,
                removeOnFail: false
            }
        );

        await recordOperationalLogSafe({
            category: "EVENT",
            action: "PARTNER_EVENT_ACCEPTED",
            level: "INFO",
            status: "RECEIVED",
            message: `Accepted BET_PLACED event ${eventId} from partner ${partnerName}`,
            targetType: "EVENT",
            targetId: eventId,
            partnerName,
            operatingMode,
            userId: ingestResult?.event?.userId || null,
            eventId,
            metadata: {
                amount,
                phone
            }
        });

        return res.status(200).json({ status: 'RECEIVED', eventId, operatingMode });

    } catch (error) {
        await recordOperationalLogSafe({
            category: "EVENT",
            action: "PARTNER_EVENT_REJECTED",
            level: "ERROR",
            status: "FAILED",
            message: `Partner event rejected: ${error.message}`,
            targetType: "EVENT",
            targetId: String(req.body?.eventId || ""),
            partnerName: req.partner?.name || null,
            operatingMode: req.partner?.operatingMode || null,
            metadata: {
                error: error.message,
                body: req.body || {}
            }
        });
        console.error("postEvent error:", error.message);
        return res.status(500).json({ status: "FAILED", reason: "Internal server error" });
    }
};
