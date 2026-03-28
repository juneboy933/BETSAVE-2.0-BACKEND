import Event from "../database/models/event.model.js";
import Partner from "../database/models/partner.model.js";
import { initiateDeposit } from "./paymentCollection.service.js";
import { initiateStkPush, isDarajaCollectionEnabled } from "./daraja.client.js";
import {
    buildEventExternalRef,
    buildEventStkIdempotencyKey,
    normalizeOperatingMode
} from "./eventReference.service.js";
import { finalizeEvent } from "./eventFinalization.service.js";
import { buildSignedCallbackUrl } from "./paymentCallbackSecurity.service.js";
import { recordOperationalLogSafe } from "./operationalLog.service.js";
import dotenv from "dotenv";

dotenv.config();

const getPartnerOperatingMode = async (partnerName) => {
    const partner = await Partner.findOne({ name: partnerName }).select("operatingMode").lean();
    return normalizeOperatingMode(partner?.operatingMode) || "demo";
};

export const processEvent = async (eventId, partnerName, requestedOperatingMode = null) => {
    const requestedMode = normalizeOperatingMode(requestedOperatingMode);
    const eventQuery = {
        eventId,
        partnerName,
        status: 'RECEIVED'
    };
    if (requestedMode) {
        eventQuery.operatingMode = requestedMode;
    }

    const event = await Event.findOneAndUpdate(
        eventQuery,
        { $set: { status: 'PROCESSING' } },
        { returnDocument: 'after' }
    );

    if (!event) return { status: 'FAILED', reason: 'Event not found or already processed' };

    await recordOperationalLogSafe({
        category: "EVENT",
        action: "EVENT_PROCESSING_STARTED",
        level: "INFO",
        status: "PROCESSING",
        message: `Started processing bet placed event ${event.eventId}`,
        targetType: "EVENT",
        targetId: String(event._id),
        partnerName: event.partnerName,
        operatingMode: event.operatingMode,
        userId: event.userId,
        eventId: event.eventId,
        metadata: {
            amount: event.amount,
            phone: event.phone
        }
    });

    try {
        if (!event.amount || event.amount <= 0) throw new Error('Invalid event amount');

        const savingspercentage = Number(process.env.SAVINGS_PERCENTAGE ?? 0.1);
        if (!Number.isFinite(savingspercentage) || savingspercentage <= 0 || savingspercentage > 1) {
            throw new Error('Invalid savings percentage configuration');
        }

        const savings = Math.round(event.amount * savingspercentage);
        if (!Number.isFinite(savings) || savings <= 0) {
            throw new Error("Computed savings amount is invalid");
        }

        let operatingMode = normalizeOperatingMode(event.operatingMode);
        if (!operatingMode) {
            operatingMode = await getPartnerOperatingMode(partnerName);
            await Event.findByIdAndUpdate(event._id, { $set: { operatingMode } });
        }
        if (!operatingMode) {
            throw new Error("Unsupported event operating mode for event-driven STK processing");
        }

        const idempotencyKey = buildEventStkIdempotencyKey({
            partnerName,
            eventId: event.eventId,
            userId: event.userId
        });
        const externalRef = buildEventExternalRef({
            partnerName,
            operatingMode,
            eventId: event.eventId
        });
        const paymentTransaction = await initiateDeposit({
            userId: event.userId,
            phone: event.phone,
            amount: savings,
            channel: "STK",
            idempotencyKey,
            externalRef
        });

        event.paymentTransactionId = paymentTransaction._id;
        await event.save();

        await recordOperationalLogSafe({
            category: "PAYMENT",
            action: "EVENT_DEPOSIT_CREATED",
            level: "INFO",
            status: paymentTransaction.status,
            message: `Created savings collection transaction for event ${event.eventId}`,
            targetType: "PAYMENT_TRANSACTION",
            targetId: String(paymentTransaction._id),
            partnerName,
            operatingMode,
            userId: event.userId,
            eventId: event.eventId,
            paymentTransactionId: paymentTransaction._id,
            externalRef,
            metadata: {
                amount: paymentTransaction.amount,
                idempotencyKey
            }
        });

        if (!isDarajaCollectionEnabled()) {
            throw new Error("Daraja collection is not configured for event-driven STK processing");
        }

        if (!paymentTransaction.providerRequestId && paymentTransaction.status === "INITIATED") {
            const providerAck = await initiateStkPush({
                phone: paymentTransaction.phone,
                amount: paymentTransaction.amount,
                accountReference: paymentTransaction.externalRef || externalRef,
                transactionDesc: `Savings collection for event ${event.eventId}`,
                callbackUrl: buildSignedCallbackUrl({
                    baseUrl: process.env.DARAJA_STK_CALLBACK_URL,
                    callbackType: "deposit",
                    resourceId: paymentTransaction._id
                })
            });

            paymentTransaction.status = "PENDING";
            paymentTransaction.providerRequestId =
                providerAck.checkoutRequestId || paymentTransaction.providerRequestId;
            paymentTransaction.providerTransactionId =
                providerAck.merchantRequestId || paymentTransaction.providerTransactionId;
            paymentTransaction.providerResponse = providerAck.raw || paymentTransaction.providerResponse;
            await paymentTransaction.save();

            await recordOperationalLogSafe({
                category: "PAYMENT",
                action: "DARAJA_STK_PUSH_ACCEPTED",
                level: "INFO",
                status: paymentTransaction.status,
                message: `Daraja accepted STK push for event ${event.eventId}`,
                targetType: "PAYMENT_TRANSACTION",
                targetId: String(paymentTransaction._id),
                partnerName,
                operatingMode,
                userId: event.userId,
                eventId: event.eventId,
                paymentTransactionId: paymentTransaction._id,
                externalRef,
                metadata: {
                    providerRequestId: paymentTransaction.providerRequestId,
                    providerTransactionId: paymentTransaction.providerTransactionId,
                    providerResponse: providerAck.raw || null
                }
            });
        }

        return {
            status: "PENDING",
            savingsAmount: Number(paymentTransaction.amount) || savings,
            paymentStatus: paymentTransaction.status,
            paymentTransactionId: String(paymentTransaction._id),
            notifyPartner: false
        };

    } catch (error) {
        await recordOperationalLogSafe({
            category: "EVENT",
            action: "EVENT_PROCESSING_FAILED",
            level: "ERROR",
            status: "FAILED",
            message: `Failed processing bet placed event ${event.eventId}: ${error.message}`,
            targetType: "EVENT",
            targetId: String(event._id),
            partnerName,
            operatingMode: event.operatingMode,
            userId: event.userId,
            eventId: event.eventId,
            paymentTransactionId: event.paymentTransactionId || null,
            metadata: {
                error: error.message
            }
        });
        await finalizeEvent({
            event,
            nextStatus: "FAILED",
            failureReason: error.message,
            notifyPartner: true
        });
        console.error('Failed to process event:', error.message);
        return { status: 'FAILED', reason: error.message, notifyPartner: false };
    }
};
