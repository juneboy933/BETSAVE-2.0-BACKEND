import mongoose from "mongoose";

const operationalLogSchema = new mongoose.Schema(
    {
        level: {
            type: String,
            enum: ["INFO", "WARN", "ERROR"],
            default: "INFO",
            index: true
        },
        category: {
            type: String,
            required: true,
            index: true
        },
        action: {
            type: String,
            required: true,
            index: true
        },
        status: {
            type: String,
            default: null,
            index: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        operatingMode: {
            type: String,
            enum: ["demo", "live"],
            default: null,
            index: true
        },
        partnerName: {
            type: String,
            default: null,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true
        },
        eventId: {
            type: String,
            default: null,
            index: true
        },
        paymentTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PaymentTransaction",
            default: null,
            index: true
        },
        withdrawalRequestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WithdrawalRequest",
            default: null,
            index: true
        },
        targetType: {
            type: String,
            default: null
        },
        targetId: {
            type: String,
            default: null,
            index: true
        },
        externalRef: {
            type: String,
            default: null,
            index: true
        },
        metadata: {
            type: Object,
            default: {}
        }
    },
    { timestamps: true }
);

operationalLogSchema.index({ createdAt: -1 });
operationalLogSchema.index({ category: 1, createdAt: -1 });
operationalLogSchema.index({ operatingMode: 1, createdAt: -1 });
operationalLogSchema.index({ paymentTransactionId: 1, createdAt: -1 });
operationalLogSchema.index({ eventId: 1, createdAt: -1 });

const OperationalLog = mongoose.model("OperationalLog", operationalLogSchema);

export default OperationalLog;
