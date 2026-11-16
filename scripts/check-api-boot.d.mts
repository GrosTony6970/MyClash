/** The types of `check-api-boot.mjs` an API test loads by `await import()` (the queue parity test). */
export declare function readSources(dir: string): Array<{ path: string; text: string }>;

export declare function processorQueues(sources: Array<{ path: string; text: string }>): {
  queues: string[];
  unresolved: string[];
};
