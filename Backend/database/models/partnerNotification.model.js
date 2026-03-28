import mongoose from "mongoose";

const partnerNotificationSchema = new mongoose.Schema(
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
        type: {
            type: String,
            required: true,
            default: "ADMIN_NOTICE"
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        payload: {
            type: Object,
            default: {}
        },
        source: {
            type: String,
            enum: ["ADMIN", "SYSTEM"],
            default: "ADMIN"
        },
        read: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

partnerNotificationSchema.index({ partnerId: 1, createdAt: -1 });

const PartnerNotification = mongoose.model("PartnerNotification", partnerNotificationSchema);

export default PartnerNotification;
