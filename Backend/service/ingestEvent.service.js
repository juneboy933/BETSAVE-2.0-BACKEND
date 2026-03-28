import Event from "../database/models/event.model.js";
import Partner from "../database/models/partner.model.js";
import PartnerUser from "../database/models/partnerUser.model.js";
import User from "../database/models/user.model.js";

export const ingestEvent = async (incomingEvent) => {
    const { eventId, phone, partnerName, type = "BET_PLACED", amount } = incomingEvent;

    // Idempotency check
    const existing = await Event.findOne({ eventId, partnerName });
    if (existing) {
        return { status: "SKIPPED", reason: "Event already processed" };
    }

    const partner = await Partner.findOne({ name: partnerName }).select("_id name operatingMode");
    if (!partner) {
        await Event.create({
            eventId,
            userId: null,
            type,
            phone,
            partnerName,
            operatingMode: "demo",
            amount,
            status: "FAILED"
        });

        return { status: "FAILED", reason: "Partner not found" };
    }

    const eventMode = String(partner.operatingMode || "demo").trim().toLowerCase() === "live"
        ? "live"
        : "demo";

    // Find user
    const user = await User.findOne({ phoneNumber: phone });
    if (!user || !user.verified) {
        await Event.create({
            eventId,
            userId: user?._id || null,
            type,
            phone,
            partnerName,
            operatingMode: eventMode,
            amount,
            status: "FAILED"
        });

        return { status: "FAILED", reason: "User not found or not verified" };
    }

    const partnerUser = await PartnerUser.findOne({ partnerId: partner._id, userId: user._id });
    if (!partnerUser) {
        await Event.create({
            eventId,
            userId: user._id,
            type,
            phone,
            partnerName,
            operatingMode: eventMode,
            amount,
            status: "FAILED"
        });

        return { status: "FAILED", reason: "User is not linked to this partner" };
    }

    if (partnerUser.status !== "VERIFIED" && partnerUser.status !== "ACTIVE") {
        await Event.create({
            eventId,
            userId: user._id,
            type,
            phone,
            partnerName,
            operatingMode: eventMode,
            amount,
            status: "FAILED"
        });

        return { status: "FAILED", reason: "User is pending verification for this partner" };
    }

    if (!partnerUser.autoSavingsEnabled) {
        await Event.create({
            eventId,
            userId: user._id,
            type,
            phone,
            partnerName,
            operatingMode: eventMode,
            amount,
            status: "FAILED"
        });

        return { status: "FAILED", reason: "Auto-savings is not enabled for this user" };
    }

    // Record event as RECEIVED
    const createdEvent = await Event.create({
        eventId,
        userId: user._id,
        phone,
        partnerName,
        operatingMode: eventMode,
        type,
        amount,
        status: "RECEIVED"
    });

    return {
        status: "RECEIVED",
        event: createdEvent
    };
};
