import mongoose from "mongoose";

const adminInvitationSchema = new mongoose.Schema(
    {
        invitationCodeHash: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true
        },
        invitationCodePreview: {
            type: String,
            required: true,
            trim: true
        },
        invitedEmail: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true
        },
        invitedName: {
            type: String,
            required: true,
            trim: true
        },
        invitedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            required: true
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true
        },
        usedAt: {
            type: Date,
            default: null
        },
        usedByAdmin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null
        },
        status: {
            type: String,
            enum: ["PENDING", "USED", "REVOKED", "EXPIRED"],
            default: "PENDING",
            index: true
        },
        notes: {
            type: String,
            trim: true,
            default: ""
        }
    },
    { timestamps: true }
);

// Compound index for finding invitations by email and status
adminInvitationSchema.index({ invitedEmail: 1, status: 1 });

const AdminInvitation = mongoose.model("AdminInvitation", adminInvitationSchema);

export default AdminInvitation;
