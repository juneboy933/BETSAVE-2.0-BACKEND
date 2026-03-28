import { Worker } from 'bullmq';
import { sendpartnerWebhook } from '../service/notifyPartner.service.js';
import redisConnection from './config.js';
import { connectDB } from '../database/config.js';
import { reportWorkerStatus, startWorkerHeartbeat } from '../service/workerStatus.service.js';

process.on("uncaughtException", (err) => {
    console.error("webhook-worker uncaughtException:", err.message);
});

process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error("webhook-worker unhandledRejection:", message);
});

await connectDB();
const stopHeartbeat = startWorkerHeartbeat({
    workerName: "webhook-worker",
    metadata: () => ({
        queue: "partner-webhook-queue",
        concurrency: 20
    })
});

const webhookWorker = new Worker(
    'partner-webhook-queue',
    async (job) => {
        const { partnerName, result, eventId } = job.data;

        // Minimal payload for partner
        const payload = result.status === 'PROCESSED'
            ? {
                eventId,
                status: 'PROCESSED',
                savingsAmount: result.savingsAmount,
                paymentStatus: result.paymentStatus || null,
                paymentTransactionId: result.paymentTransactionId || null
            }
            : { eventId, status: 'FAILED', reason: result.reason };

        await sendpartnerWebhook({ partnerName, payload });
    },
    { connection: redisConnection, concurrency: 20 }
);

webhookWorker.on('completed', (job) => {
    void reportWorkerStatus({
        workerName: "webhook-worker",
        status: "RUNNING",
        markSuccess: true,
        metadata: {
            queue: "partner-webhook-queue",
            lastJobId: job.id,
            lastJobName: job.name
        }
    });
    console.log(`[${job.name}] completed`, job.id);
});

webhookWorker.on('failed', (job, err) => {
    void reportWorkerStatus({
        workerName: "webhook-worker",
        status: "ERROR",
        markError: true,
        errorMessage: err.message,
        metadata: {
            queue: "partner-webhook-queue",
            lastJobId: job?.id || null,
            lastJobName: job?.name || null
        }
    });
    console.error(`[${job?.name}] failed`, job?.id, err.message);
    if ((job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 0) && job?.opts?.attempts) {
        console.error('PERMANENT FAILURE', { jobId: job.id, partnerName: job.data.partnerName, eventId: job.data.eventId });
    }
});

webhookWorker.on("error", (err) => {
    void reportWorkerStatus({
        workerName: "webhook-worker",
        status: "ERROR",
        markError: true,
        errorMessage: err.message,
        metadata: {
            queue: "partner-webhook-queue"
        }
    });
    console.error("webhook-worker error:", err.message);
});

const shutdown = async () => {
    await stopHeartbeat();
    process.exit(0);
};

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
