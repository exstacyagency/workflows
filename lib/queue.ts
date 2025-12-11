import Bull from 'bull';
import Redis from 'ioredis';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const connection = new Redis(redisConfig);

export enum QueueName {
  CUSTOMER_RESEARCH = 'customer-research',
  AD_COLLECTION = 'ad-collection',
  AD_TRANSCRIPTS = 'ad-transcripts',
  PATTERN_ANALYSIS = 'pattern-analysis',
  SCRIPT_GENERATION = 'script-generation',
  VIDEO_GENERATION = 'video-generation',
  VIDEO_UPSCALE = 'video-upscale',
}

const queues = new Map<QueueName, Bull.Queue>();

export function getQueue(name: QueueName): Bull.Queue {
  if (!queues.has(name)) {
    queues.set(name, new Bull(name, { 
      redis: redisConfig,
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
  const queue = getQueue(queueName);
  return queue.add(data, {
    jobId,
    ...opts,
  });
}

export async function getJobStatus(queueName: QueueName, jobId: string) {
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
