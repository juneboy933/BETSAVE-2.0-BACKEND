import mongoose from "mongoose";

const withdrawalRequestSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    amount: {
        type: Number,
        required: true,
        min: 0
    },

    status: {
        type: String,
        required: true,
        enum: ["REQUESTED", "RESERVED", "DISBURSED", "REVERSED", "FAILED"],
        default: "REQUESTED"
    },

    paymentTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PaymentTransaction",
        default: null
    },

    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        default: null
    },

    notes: {
        type: String,
        trim: true,
        default: null
    }
}, { timestamps: true });

withdrawalRequestSchema.index({ userId: 1, status: 1, createdAt: -1 });
withdrawalRequestSchema.index({ paymentTransactionId: 1 }, { unique: true, sparse: true });

const WithdrawalRequest = mongoose.model("WithdrawalRequest", withdrawalRequestSchema);

export default WithdrawalRequest;
