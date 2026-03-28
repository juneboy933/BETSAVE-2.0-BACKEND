import Event from "../database/models/event.model.js";
import { webhookQueue } from "../worker/queues.js";
import { parseEventReference } from "./eventReference.service.js";

const buildWebhookResult = ({ nextStatus, paymentTransaction = null, failureReason = null }) =>
    nextStatus === "PROCESSED"
        ? {
            status: "PROCESSED",
            savingsAmount: Number(paymentTransaction?.amount) || 0,
            paymentStatus: paymentTransaction?.status || null,
            paymentTransactionId: paymentTransaction?._id ? String(paymentTransaction._id) : null
        }
        : {
            status: "FAILED",
            reason: String(failureReason || paymentTransaction?.failureReason || "Event processing failed"),
            paymentStatus: paymentTransaction?.status || null,
            paymentTransactionId: paymentTransaction?._id ? String(paymentTransaction._id) : null
        };

const enqueueWebhook = async ({ event, result }) => {
    await webhookQueue.add("send-webhook", {
        eventId: event.eventId,
        partnerName: event.partnerName,
        result
    }, {
        jobId: `webhook-${event.partnerName}-${event.eventId}-${result.status.toLowerCase()}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: true,
        removeOnFail: false
    });
};

const buildEventQuery = ({
    event,
    eventId,
    partnerName,
    operatingMode,
    userId,
    paymentTransaction
}) => {
    if (event?._id) {
        return { _id: event._id };
    }

    const resolvedEventId = eventId || parseEventReference(paymentTransaction?.externalRef)?.eventId;
    const query = {};

    if (resolvedEventId) {
        query.eventId = resolvedEventId;
    }
    if (partnerName) {
        query.partnerName = partnerName;
    }
    if (operatingMode) {
        query.operatingMode = operatingMode;
    }
    if (userId || paymentTransaction?.userId) {
        query.userId = userId || paymentTransaction?.userId;
    }

    return query;
};

export const finalizeEvent = async ({
    event = null,
    eventId = null,
    partnerName = null,
    operatingMode = null,
    userId = null,
    paymentTransaction = null,
    nextStatus,
    failureReason = null,
    notifyPartner = true
}) => {
    const eventQuery = buildEventQuery({
        event,
        eventId,
        partnerName,
        operatingMode,
        userId,
        paymentTransaction
    });

    if (!Object.keys(eventQuery).length) {
        return null;
    }

    const resolvedEvent = event || await Event.findOne(eventQuery).sort({ createdAt: -1 });
    if (!resolvedEvent) {
        return null;
    }

    const result = buildWebhookResult({ nextStatus, paymentTransaction, failureReason });
    const shouldNotifyPartner = notifyPartner && resolvedEvent.lastNotificationStatus !== result.status;

    resolvedEvent.status = nextStatus;
    resolvedEvent.paymentTransactionId = paymentTransaction?._id || resolvedEvent.paymentTransactionId || null;
    resolvedEvent.finalizedAt = new Date();
    resolvedEvent.failureReason = nextStatus === "FAILED" ? result.reason : null;
    if (shouldNotifyPartner) {
        resolvedEvent.lastNotificationStatus = result.status;
        resolvedEvent.lastNotificationAt = new Date();
    }
    await resolvedEvent.save();

    if (shouldNotifyPartner) {
        try {
            await enqueueWebhook({ event: resolvedEvent, result });
        } catch (error) {
            console.error("Failed to enqueue callback webhook job:", error.message);
        }
    }

    return resolvedEvent;
};
