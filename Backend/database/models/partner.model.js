import mongoose from "mongoose";

const partnerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    apiKey: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    apiSecret: {
        type: String,
        default: null,
        select: false
    },
    apiSecretEncrypted: {
        type: String,
        default: null,
        select: false
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'SUSPENDED'],
        default: 'ACTIVE'
    },
    operatingMode: {
        type: String,
        enum: ["demo", "live"],
        default: "demo",
        index: true
    },
    webhookUrl: {
        type: String,
        default: null
    }
}, { timestamps: true });

const Partner = mongoose.model('Partner', partnerSchema);

export default Partner;
