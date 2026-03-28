import os from "os";
import WorkerStatus from "../database/models/workerStatus.model.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;

const resolveMetadata = (metadataProvider) => {
    if (typeof metadataProvider === "function") {
        return metadataProvider() || null;
    }
    return metadataProvider || null;
};

export const reportWorkerStatus = async ({
    workerName,
    status = "RUNNING",
    metadata = null,
    errorMessage = null,
    markSuccess = false,
    markError = false
}) => {
    if (!workerName) {
        throw new Error("workerName is required");
    }

    const now = new Date();
    const update = {
        $set: {
            status,
            hostname: os.hostname(),
            pid: process.pid,
            lastHeartbeatAt: now,
            metadata: metadata || null,
            errorMessage: errorMessage || null
        }
    };

    if (markSuccess) {
        update.$set.lastSuccessAt = now;
    }

    if (markError) {
        update.$set.lastErrorAt = now;
    }

    await WorkerStatus.updateOne(
        { workerName },
        update,
        { upsert: true }
    );
};

export const startWorkerHeartbeat = ({
    workerName,
    intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    metadata = null
}) => {
    let stopped = false;

    const tick = async () => {
        if (stopped) {
            return;
        }

        try {
            await reportWorkerStatus({
                workerName,
                status: "RUNNING",
                metadata: resolveMetadata(metadata)
            });
        } catch (error) {
            console.error(`[${workerName}] heartbeat failed:`, error.message);
        }
    };

    void tick();
    const timer = setInterval(() => {
        void tick();
    }, intervalMs);

    if (typeof timer.unref === "function") {
        timer.unref();
    }

    return async () => {
        stopped = true;
        clearInterval(timer);
        try {
            await reportWorkerStatus({
                workerName,
                status: "STOPPED",
                metadata: resolveMetadata(metadata)
            });
        } catch (error) {
            console.error(`[${workerName}] failed to mark stopped:`, error.message);
        }
    };
};
