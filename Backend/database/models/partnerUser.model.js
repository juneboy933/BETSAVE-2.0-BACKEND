import mongoose from "mongoose";

const partnerUserSchema = new mongoose.Schema(
    {
        partnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Partner",
            required: true,
            index: true
        },
        partnerName: {
            type: String,
            required: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        phoneNumber: {
            type: String,
            required: true,
            index: true
        },
        source: {
            type: String,
            enum: ["REGISTERED", "INFERRED"],
            default: "REGISTERED"
        },
        status: {
            type: String,
            enum: ["PENDING", "VERIFIED", "ACTIVE", "SUSPENDED"],
            default: "PENDING"
        },
        hashedOTP: {
            type: String,
            default: null
        },
        otpExpiresAt: {
            type: Date,
            default: null
        },
        otpAttempts: {
            type: Number,
            default: 0
        },
        autoSavingsEnabled: {
            type: Boolean,
            default: false
        },
        autoSavingsEnabledAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

partnerUserSchema.index({ partnerId: 1, userId: 1 }, { unique: true });
partnerUserSchema.index({ partnerId: 1, phoneNumber: 1 }, { unique: true });

const PartnerUser = mongoose.model("PartnerUser", partnerUserSchema);

export default PartnerUser;
