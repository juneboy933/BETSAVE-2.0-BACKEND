import { Queue } from 'bullmq';
import redisConnection from './config.js';

// Event processing queue
export const eventQueue = new Queue('event-processing-queue', { connection: redisConnection });
// new QueueScheduler('event-processing-queue', { connection: redisConnection });

// Partner webhook queue
export const webhookQueue = new Queue('partner-webhook-queue', { connection: redisConnection });
// new QueueScheduler('partner-webhook-queue', { connection: redisConnection });
