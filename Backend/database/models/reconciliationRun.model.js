import mongoose from "mongoose";

const discrepancySchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        trim: true
    },
    expectedAmount: {
        type: Number,
        required: true,
        default: 0
    },
    providerAmount: {
        type: Number,
        required: true,
        default: 0
    },
    variance: {
        type: Number,
        required: true,
        default: 0
    },
    notes: {
        type: String,
        trim: true,
        default: null
    }
}, { _id: false });

const reconciliationRunSchema = new mongoose.Schema({
    runDate: {
        type: Date,
        required: true,
        index: true
    },

    source: {
        type: String,
        default: "SAFARICOM_PAYBILL",
        index: true
    },

    batchReference: {
        type: String,
        trim: true,
        default: null,
        index: true
    },

    settlementAccount: {
        type: String,
        trim: true,
        default: null
    },

    status: {
        type: String,
        required: true,
        enum: ["PENDING", "COMPLETED", "FAILED"],
        default: "PENDING"
    },

    expectedTotal: {
        type: Number,
        required: true,
        default: 0
    },

    providerTotal: {
        type: Number,
        required: true,
        default: 0
    },

    matchedTransactions: {
        type: Number,
        required: true,
        default: 0
    },

    settledTransactions: {
        type: Number,
        required: true,
        default: 0
    },

    duplicateTransactions: {
        type: Number,
        required: true,
        default: 0
    },

    unmatchedTransactions: {
        type: Number,
        required: true,
        default: 0
    },

    variance: {
        type: Number,
        required: true,
        default: 0
    },

    discrepancies: {
        type: [discrepancySchema],
        default: []
    },

    metadata: {
        type: Object,
        default: {}
    }
}, { timestamps: true });

reconciliationRunSchema.index({ runDate: 1, createdAt: -1 });
reconciliationRunSchema.index({ source: 1, createdAt: -1 });

const ReconciliationRun = mongoose.model("ReconciliationRun", reconciliationRunSchema);

export default ReconciliationRun;
