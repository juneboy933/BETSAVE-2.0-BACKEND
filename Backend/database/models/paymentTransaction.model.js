import mongoose from "mongoose";

const paymentTransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ["DEPOSIT", "WITHDRAWAL"]
    },

    channel: {
        type: String,
        required: true,
        enum: ["C2B", "STK", "B2C"]
    },

    status: {
        type: String,
        required: true,
        enum: ["INITIATED", "PENDING", "SUCCESS", "FAILED"],
        default: "INITIATED"
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    partnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Partner",
        default: null,
        index: true
    },

    partnerName: {
        type: String,
        trim: true,
        default: null,
        index: true
    },

    requestedByType: {
        type: String,
        enum: ["USER", "PARTNER"],
        default: "USER",
        index: true
    },

    phone: {
        type: String,
        required: true,
        trim: true
    },

    amount: {
        type: Number,
        required: true,
        min: 0
    },

    currency: {
        type: String,
        default: "KES",
        trim: true
    },

    externalRef: {
        type: String,
        trim: true,
        default: null
    },

    providerRequestId: {
        type: String,
        trim: true,
        default: null,
        index: true
    },

    providerTransactionId: {
        type: String,
        trim: true,
        default: null,
        index: true
    },

    providerResponse: {
        type: Object,
        default: null
    },

    rawCallback: {
        type: Object,
        default: null
    },

    settlementStatus: {
        type: String,
        enum: ["NOT_APPLICABLE", "PENDING", "SETTLED", "EXCEPTION"],
        default: function () {
            return this.type === "DEPOSIT" ? "PENDING" : "NOT_APPLICABLE";
        },
        index: true
    },

    settlementReference: {
        type: String,
        trim: true,
        default: null,
        index: true
    },

    settlementBatchKey: {
        type: String,
        trim: true,
        default: null,
        index: true
    },

    settledAt: {
        type: Date,
        default: null,
        index: true
    },

    settlementFailureReason: {
        type: String,
        trim: true,
        default: null
    },

    settlementMetadata: {
        type: Object,
        default: null
    },

    failureReason: {
        type: String,
        trim: true,
        default: null
    },

    idempotencyKey: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true
    }
}, { timestamps: true });

paymentTransactionSchema.index({ userId: 1, createdAt: -1 });
paymentTransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
paymentTransactionSchema.index({ type: 1, status: 1, updatedAt: -1 });
paymentTransactionSchema.index({ type: 1, settlementStatus: 1, updatedAt: -1 });
paymentTransactionSchema.index({ externalRef: 1, createdAt: -1 });
paymentTransactionSchema.index({ partnerId: 1, type: 1, createdAt: -1 });

const PaymentTransaction = mongoose.model("PaymentTransaction", paymentTransactionSchema);

export default PaymentTransaction;
