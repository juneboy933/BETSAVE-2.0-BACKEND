import mongoose from "mongoose";

const ledgerSchema = new mongoose.Schema({
    eventId: {
        type: String,
        required: true,
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true
    },

    account: {
        type: String,
        required: true,
        enum: [
            "USER_SAVINGS",
            "OPERATOR_CLEARING",
            "BANK_SETTLEMENT",
            "MPESA_COLLECTION",
            "USER_WALLET_LIABILITY",
            "WITHDRAWAL_PENDING",
            "MPESA_DISBURSEMENT",
            "RECON_ADJUSTMENT"
        ]
    },

    amount: {
        type: Number,
        required: true
    },

    currency: {
        type: String,
        default: "KES"
    },

    reference: {
        type: String
    },

    idempotencyKey: {
        type: String,
        required: true,
        trim: true
    }

}, { timestamps: true });

ledgerSchema.index({ idempotencyKey: 1 }, { unique: true });

const Ledger = mongoose.model("Ledger", ledgerSchema);

export default Ledger;
