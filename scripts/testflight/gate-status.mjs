import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The Flutter gate runs in its own jobs of this workflow run. The Apple jobs
// poll this run's jobs and upload only once every gate job has succeeded.
export function gateJobNames(shards = 4) {
  return [
    'Flutter lint',
    ...Array.from({ length: shards }, (_, index) => `Flutter tests (shard ${index} of ${shards})`),
  ];
}

export function gateStatus(jobs, { shards = 4 } = {}) {
  const byName = new Map((jobs ?? []).map((job) => [job.name, job]));
  const expected = gateJobNames(shards).map((name) => byName.get(name));

  if (expected.some((job) => job?.status === 'completed' && job.conclusion !== 'success')) {
    return 'failed';
  }
  if (expected.every((job) => job?.status === 'completed' && job.conclusion === 'success')) {
    return 'passed';
  }
  return 'pending';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const response = JSON.parse(readFileSync(0, 'utf8'));
  console.log(gateStatus(response.jobs));
}
