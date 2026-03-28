import { Redis } from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const workerConfigDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(workerConfigDir, '../.env') });

const redisUri = process.env.REDIS_URI;

if(!redisUri){
    throw new Error('REDIS_URI is not defined in environment variables.');
}

const redisConnection = new Redis(redisUri, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
});

// await redisConnection.connect();

export default redisConnection;
