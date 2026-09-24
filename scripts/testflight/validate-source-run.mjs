import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const requiredSourceJobs = [
  'root-tests',
  'flutter-quality',
  'critical-journeys',
  'firestore-rules',
  'release-policy',
];
const genericFailure = 'source workflow run did not meet publishing requirements';

function invalidSourceRun() {
  throw new Error(genericFailure);
}

function isPositiveDecimal(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

export function validateSourceRun(run, jobs, expected) {
  if (
    !run ||
    typeof run !== 'object' ||
    !Array.isArray(jobs) ||
    !expected ||
    typeof expected !== 'object' ||
    expected.sourceRef !== 'dev' ||
    typeof expected.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(expected.sourceSha) ||
    !isPositiveDecimal(expected.sourceRunId) ||
    !isPositiveDecimal(expected.sourceRunAttempt) ||
    Number(expected.sourceRunAttempt) > 51 ||
    String(run.id) !== expected.sourceRunId ||
    String(run.run_attempt) !== expected.sourceRunAttempt ||
    run.event !== 'push' ||
    run.head_branch !== 'dev' ||
    run.head_sha !== expected.sourceSha ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  ) {
    invalidSourceRun();
  }

  for (const requiredName of requiredSourceJobs) {
    const matchingJobs = jobs.filter((job) => job?.name === requiredName);
    if (
      matchingJobs.length === 0 ||
      matchingJobs.some(
        (job) => job.status !== 'completed' || job.conclusion !== 'success',
      )
    ) {
      invalidSourceRun();
    }
  }

  return true;
}

function validateSourceRunFiles(args) {
  if (args.length !== 6) invalidSourceRun();
  const [runPath, jobsPath, sourceRef, sourceSha, sourceRunId, sourceRunAttempt] = args;
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  const jobResponse = JSON.parse(readFileSync(jobsPath, 'utf8'));
  const jobs = Array.isArray(jobResponse) ? jobResponse : jobResponse.jobs;

  return validateSourceRun(run, jobs, {
    sourceRef,
    sourceSha,
    sourceRunId,
    sourceRunAttempt,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateSourceRunFiles(process.argv.slice(2));
    process.stdout.write('source run validated\n');
  } catch {
    process.stderr.write(`${genericFailure}\n`);
    process.exitCode = 1;
  }
}
