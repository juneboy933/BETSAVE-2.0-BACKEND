import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { setTransactionSupport } from "../service/databaseSession.service.js";

const dbConfigDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dbConfigDir, "../.env") });

const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    throw new Error("MONGO_URI is not defined in environment variables.");
}

const parseNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || String(value).trim() === "") {
        return fallback;
    }

    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return fallback;
};

let listenersAttached = false;

const attachConnectionListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;

    mongoose.connection.on("connected", () => {
        console.log("MongoDB connected");
    });

    mongoose.connection.on("disconnected", () => {
        console.error("MongoDB disconnected");
    });

    mongoose.connection.on("reconnected", () => {
        console.log("MongoDB reconnected");
    });

    mongoose.connection.on("error", (error) => {
        console.error("MongoDB connection error:", error.message);
    });
};

export const isDatabaseReady = () => mongoose.connection.readyState === 1;

const detectTransactionSupport = async () => {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello?.setName || hello?.msg === "isdbgrid");
};

export const connectDB = async () => {
    attachConnectionListeners();

    const maxPoolSize = parseNumber(process.env.MONGO_MAX_POOL_SIZE, 20);
    const minPoolSize = parseNumber(process.env.MONGO_MIN_POOL_SIZE, 2);
    const serverSelectionTimeoutMS = parseNumber(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 15000);
    const connectTimeoutMS = parseNumber(process.env.MONGO_CONNECT_TIMEOUT_MS, 30000);
    const socketTimeoutMS = parseNumber(process.env.MONGO_SOCKET_TIMEOUT_MS, 45000);
    const maxIdleTimeMS = parseNumber(process.env.MONGO_MAX_IDLE_TIME_MS, 60000);
    const initialRetries = parseNumber(process.env.MONGO_INITIAL_CONNECT_RETRIES, 10);
    const retryDelayMS = parseNumber(process.env.MONGO_INITIAL_CONNECT_RETRY_DELAY_MS, 3000);

    let attempt = 0;
    let lastError = null;

    while (attempt < initialRetries) {
        attempt += 1;
        try {
            await mongoose.connect(mongoUri, {
                maxPoolSize,
                minPoolSize,
                serverSelectionTimeoutMS,
                connectTimeoutMS,
                socketTimeoutMS,
                maxIdleTimeMS
            });

            const transactionsSupported = await detectTransactionSupport();
            setTransactionSupport(transactionsSupported);

            const requireTransactions = parseBoolean(
                process.env.MONGO_REQUIRE_TRANSACTIONS,
                String(process.env.NODE_ENV || "").trim().toLowerCase() === "production"
            );

            if (requireTransactions && !transactionsSupported) {
                throw new Error(
                    "MongoDB transactions are required but unsupported. Configure a replica set or mongos deployment."
                );
            }

            console.log(
                `MongoDB transaction support: ${transactionsSupported ? "ENABLED" : "DISABLED"}`
            );
            console.log("Database connected successfully");
            return mongoose.connection;
        } catch (error) {
            lastError = error;
            console.error(
                `Error connecting to database (attempt ${attempt}/${initialRetries}): ${error.message}`
            );

            if (attempt < initialRetries) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMS));
            }
        }
    }

    throw lastError || new Error("Failed to connect to MongoDB");
};
