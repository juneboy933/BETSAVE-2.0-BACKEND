import mongoose from "mongoose";

const workerStatusSchema = new mongoose.Schema(
    {
        workerName: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true
        },
        status: {
            type: String,
            enum: ["RUNNING", "DEGRADED", "ERROR", "STOPPED"],
            default: "RUNNING"
        },
        hostname: {
            type: String,
            trim: true,
            default: null
        },
        pid: {
            type: Number,
            default: null
        },
        lastHeartbeatAt: {
            type: Date,
            default: null,
            index: true
        },
        lastSuccessAt: {
            type: Date,
            default: null
        },
        lastErrorAt: {
            type: Date,
            default: null
        },
        errorMessage: {
            type: String,
            trim: true,
            default: null
        },
        metadata: {
            type: Object,
            default: null
        }
    },
    { timestamps: true }
);

const WorkerStatus = mongoose.model("WorkerStatus", workerStatusSchema);

export default WorkerStatus;
