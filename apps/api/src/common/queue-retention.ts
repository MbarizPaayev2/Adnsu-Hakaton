/** Failed jobs are kept long enough to diagnose and retry, never forever. */
export const FAILED_JOB_RETENTION = { age: 14 * 24 * 60 * 60, count: 5000 };

export const QUEUE_RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: FAILED_JOB_RETENTION,
};
