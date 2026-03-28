import { Worker } from 'bullmq';
import { processEvent } from '../service/processEvent.service.js';
import redisConnection from './config.js';
import { connectDB } from '../database/config.js'
import { reportWorkerStatus, startWorkerHeartbeat } from '../service/workerStatus.service.js';

process.on("uncaughtException", (err) => {
    console.error("event-worker uncaughtException:", err.message);
});

process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error("event-worker unhandledRejection:", message);
});

await connectDB();
console.log("event-worker connected and waiting for jobs on event-processing-queue");
const stopHeartbeat = startWorkerHeartbeat({
    workerName: "event-worker",
    metadata: () => ({
        queue: "event-processing-queue",
        concurrency: 10
    })
});

const eventWorker = new Worker(
    'event-processing-queue',
    async (job) => {
        const { eventId, partnerName, operatingMode } = job.data;

        return processEvent(eventId, partnerName, operatingMode);
    },
    { connection: redisConnection, concurrency: 10 }
);

eventWorker.on('completed', (job) => {
    void reportWorkerStatus({
        workerName: "event-worker",
        status: "RUNNING",
        markSuccess: true,
        metadata: {
            queue: "event-processing-queue",
            lastJobId: job.id,
            lastJobName: job.name
        }
    });
    console.log(`[${job.name}] completed`, job.id);
});
eventWorker.on('active', (job) => console.log(`[${job.name}] active`, job.id));
eventWorker.on('failed', (job, err) => {
    void reportWorkerStatus({
        workerName: "event-worker",
        status: "ERROR",
        markError: true,
        errorMessage: err.message,
        metadata: {
            queue: "event-processing-queue",
            lastJobId: job?.id || null,
            lastJobName: job?.name || null
        }
    });
    console.error(`[${job?.name}] failed`, job?.id, err.message);
});
eventWorker.on("error", (err) => {
    void reportWorkerStatus({
        workerName: "event-worker",
        status: "ERROR",
        markError: true,
        errorMessage: err.message,
        metadata: {
            queue: "event-processing-queue"
        }
    });
    console.error("event-worker error:", err.message);
});

const shutdown = async () => {
    await stopHeartbeat();
    process.exit(0);
};

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
