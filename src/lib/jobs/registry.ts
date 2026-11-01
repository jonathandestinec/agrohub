const jobs = new Map<string, () => Promise<void>>();

export function defineJob(name: string, handler: () => Promise<void>): void {
  if (jobs.has(name)) {
    throw new Error(`Job already defined: ${name}`);
  }
  jobs.set(name, handler);
}

export function getJob(name: string): (() => Promise<void>) | undefined {
  return jobs.get(name);
}

/** Test-only: empties the registry. */
export function resetJobsForTests(): void {
  jobs.clear();
}
