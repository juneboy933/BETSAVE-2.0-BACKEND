import { connectDB } from "../database/config.js";
import { runOperationalRecovery } from "../service/operationalRecovery.service.js";
import { reportWorkerStatus, startWorkerHeartbeat } from "../service/workerStatus.service.js";

const parsePositiveNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const intervalMs = parsePositiveNumber(process.env.OPERATIONAL_RECOVERY_INTERVAL_MS, 60000);
let recoveryInFlight = false;

process.on("uncaughtException", (err) => {
    console.error("recovery-worker uncaughtException:", err.message);
});

process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error("recovery-worker unhandledRejection:", message);
});

const runRecoveryCycle = async () => {
    if (recoveryInFlight) {
        return;
    }

    recoveryInFlight = true;
    try {
        const result = await runOperationalRecovery();
        await reportWorkerStatus({
            workerName: "recovery-worker",
            status: "RUNNING",
            markSuccess: true,
            metadata: {
                intervalMs,
                lastCycle: result
            }
        });
        const hasWork =
            result.eventRecovery.inspected > 0 ||
            result.failedInitiatedDeposits > 0 ||
            result.failedInitiatedWithdrawals > 0 ||
            result.stalePendingDeposits > 0 ||
            result.stalePendingWithdrawals > 0 ||
            result.staleProcessingEvents > 0;

        if (hasWork) {
            console.log("[recovery-worker] cycle summary", JSON.stringify(result));
        }
    } catch (error) {
        await reportWorkerStatus({
            workerName: "recovery-worker",
            status: "ERROR",
            markError: true,
            errorMessage: error.message,
            metadata: {
                intervalMs
            }
        });
        console.error("[recovery-worker] cycle failed:", error.message);
    } finally {
        recoveryInFlight = false;
    }
};

await connectDB();
console.log(`recovery-worker connected; interval=${intervalMs}ms`);
const stopHeartbeat = startWorkerHeartbeat({
    workerName: "recovery-worker",
    metadata: () => ({
        intervalMs
    })
});

await runRecoveryCycle();
setInterval(() => {
    void runRecoveryCycle();
}, intervalMs);

const shutdown = async () => {
    await stopHeartbeat();
    process.exit(0);
};

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
