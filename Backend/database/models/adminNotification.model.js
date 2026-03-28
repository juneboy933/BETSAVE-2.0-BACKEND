import mongoose from "mongoose";

const adminNotificationSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            index: true
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
        actorName: {
            type: String,
            trim: true,
            default: "Admin"
        },
        actorEmail: {
            type: String,
            trim: true,
            default: null
        },
        targetType: {
            type: String,
            required: true
        },
        targetId: {
            type: String,
            required: true,
            index: true
        },
        metadata: {
            type: Object,
            default: {}
        },
        read: {
            type: Boolean,
            default: false
        },
        readAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

adminNotificationSchema.index({ createdAt: -1 });

const AdminNotification = mongoose.model("AdminNotification", adminNotificationSchema);

export default AdminNotification;
