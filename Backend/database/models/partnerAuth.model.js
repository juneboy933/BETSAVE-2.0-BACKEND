import mongoose from "mongoose";

const partnerAuthSchema = new mongoose.Schema({
    partnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Partner",
        required: true,
        unique: true,
        index: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    passwordSalt: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'SUSPENDED'],
        default: 'ACTIVE'
    },
    lastLoginAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

const PartnerAuth = mongoose.model('PartnerAuth', partnerAuthSchema);

export default PartnerAuth;
