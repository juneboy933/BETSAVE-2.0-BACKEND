import mongoose from "mongoose";

const eventSchema = new mongoose.Schema({
    eventId: {
        type: String,
        required: true,
        index: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        default: null,
    },
    paymentTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PaymentTransaction",
        required: false,
        default: null,
        index: true
    },
    phone: {
        type: String,
        required: true,
    },
    partnerName: {
        type: String,
        required: true,
    },
    operatingMode: {
        type: String,
        enum: ["demo", "live"],
        default: "demo",
        index: true
    },
    type: {
        type: String,
        required: true,
        default: 'BET_PLACED',
    },
    amount: {
        type: Number,
        required: true,
        default: 0
    },
    status: {
        type: String,
        enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'],
        default: 'RECEIVED'
    },
    failureReason: {
        type: String,
        trim: true,
        default: null
    },
    finalizedAt: {
        type: Date,
        default: null
    },
    lastNotificationStatus: {
        type: String,
        enum: ['PROCESSED', 'FAILED'],
        default: null
    },
    lastNotificationAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

eventSchema.index({ partnerName: 1, eventId: 1 }, { unique: true });
eventSchema.index({ partnerName: 1, operatingMode: 1, createdAt: -1 });
eventSchema.index({ userId: 1, createdAt: -1 });
eventSchema.index({ status: 1, operatingMode: 1, updatedAt: -1 });
eventSchema.index({ paymentTransactionId: 1, updatedAt: -1 });

const Event = mongoose.model('Event', eventSchema);

export default Event;
