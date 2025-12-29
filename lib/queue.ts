import { cfg } from "@/lib/config";
import { isSelfHosted } from "@/lib/config/mode";
import Bull from 'bull';
import Redis from 'ioredis';

function getQueueBackend(): "db" | "redis" {
  if (isSelfHosted()) return (cfg.raw("QUEUE_BACKEND") as any) === "redis" ? "redis" : "db";
  return (cfg.raw("QUEUE_BACKEND") as any) === "redis" ? "redis" : "db";
}

function assertRedisConfigured() {
  const url = (cfg.raw("REDIS_URL") ?? "").trim();
  if (!url) throw new Error("QUEUE_BACKEND=redis requires REDIS_URL");
  return url;
}

const REDIS_URL = (cfg.raw("REDIS_URL") ?? '').trim();

const redisBaseOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

export const redis: Redis | null = (() => {
  if (!REDIS_URL) return null;
  try {
    const client = new Redis(REDIS_URL, { ...redisBaseOptions });
    client.on('error', (err) => {
      console.error('[redis] error', (err as any)?.message ?? err);
    });
    return client;
  } catch (err) {
    console.error('[redis] init error', (err as any)?.message ?? err);
    return null;
  }
})();

export const QueueName = {
  CUSTOMER_RESEARCH: 'customer-research',
  AD_COLLECTION: 'ad-collection',
  AD_TRANSCRIPTS: 'ad-transcripts',
  PATTERN_ANALYSIS: 'pattern-analysis',
  SCRIPT_GENERATION: 'script-generation',
  VIDEO_GENERATION: 'video-generation',
  VIDEO_UPSCALE: 'video-upscale',
} as const;
export type QueueName = typeof QueueName[keyof typeof QueueName];

const queues = new Map<QueueName, Bull.Queue>();

function createNoopQueue(name: QueueName) {
  const queueName = String(name);
  return {
    process: () => {
      console.warn(`[queue] noop process(): redis disabled queue=${queueName}`);
    },
    add: async () => {
      throw new Error('Redis not configured (REDIS_URL missing)');
    },
    getJob: async () => null,
  } as any as Bull.Queue;
}

function createBullRedisClient(type: string, config: any) {
  const client =
    type === 'bclient' || type === 'subscriber'
      ? new Redis({ ...config, maxRetriesPerRequest: null, enableReadyCheck: false })
      : new Redis({ ...config, ...redisBaseOptions });

  client.on('error', (err) => {
    console.error('[redis] error', (err as any)?.message ?? err);
  });

  return client;
}

function assertRedisAvailable() {
  if (getQueueBackend() !== "redis") {
    throw new Error("QUEUE_BACKEND=db; redis queue unavailable");
  }
  const url = assertRedisConfigured();
  if (!redis) throw new Error('Redis not available (failed to initialize)');
  return url;
}

export function getQueue(name: QueueName): Bull.Queue {
  const url = assertRedisAvailable();
  if (!queues.has(name)) {
    queues.set(name, new Bull(name, url, { 
      redis: { ...redisBaseOptions },
      createClient: createBullRedisClient,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }));
  }
  return queues.get(name)!;
}

export async function addJob<T>(
  queueName: QueueName,
  jobId: string,
  data: T,
  opts?: Bull.JobOptions
) {
  assertRedisAvailable();
  const queue = getQueue(queueName);
  return queue.add(data, {
    jobId,
    ...opts,
  });
}

export async function getJobStatus(queueName: QueueName, jobId: string) {
  assertRedisAvailable();
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);
  
  if (!job) return null;
  
  const state = await job.getState();
  const progress = job.progress();
  const failedReason = job.failedReason;
  
  return {
    id: job.id,
    state,
    progress,
    failedReason,
    data: job.data,
    returnvalue: job.returnvalue,
  };
}
