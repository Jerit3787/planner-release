import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateSourceRun } from '../../scripts/testflight/validate-source-run.mjs';

const expected = {
  sourceRef: 'dev',
  sourceSha: 'a'.repeat(40),
  sourceRunId: '4100000000',
  sourceRunAttempt: '2',
};
const run = {
  id: 4100000000,
  run_attempt: 2,
  event: 'push',
  head_branch: 'dev',
  head_sha: expected.sourceSha,
  status: 'completed',
  conclusion: 'success',
};
const requiredJobs = [
  'root-tests', 'flutter-quality', 'critical-journeys',
  'firestore-rules', 'release-policy',
].map((name) => ({ name, status: 'completed', conclusion: 'success' }));

describe('validateSourceRun', () => {
  it('accepts only the exact successful dev push and required checks', () => {
    assert.equal(validateSourceRun(run, requiredJobs, expected), true);
  });

  it('rejects wrong event, ref, SHA, run ID, or attempt', () => {
    for (const [runOverride, expectedOverride] of [
      [{ event: 'pull_request' }, {}],
      [{ head_branch: 'main' }, {}],
      [{ head_sha: 'b'.repeat(40) }, {}],
      [{ id: 4100000001 }, {}],
      [{ run_attempt: 3 }, {}],
      [{}, { sourceRef: 'main' }],
      [{}, { sourceSha: 'b'.repeat(40) }],
      [{}, { sourceRunId: '4100000001' }],
      [{}, { sourceRunAttempt: '3' }],
    ]) {
      assert.throws(
        () => validateSourceRun(
          { ...run, ...runOverride },
          requiredJobs,
          { ...expected, ...expectedOverride },
        ),
        /source workflow run did not meet publishing requirements/,
      );
    }
  });

  it('rejects queued, in-progress, failed, cancelled, or timed-out source runs', () => {
    for (const override of [
      { status: 'queued', conclusion: null },
      { status: 'in_progress', conclusion: null },
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'cancelled' },
      { status: 'completed', conclusion: 'timed_out' },
    ]) {
      assert.throws(
        () => validateSourceRun({ ...run, ...override }, requiredJobs, expected),
        /source workflow run did not meet publishing requirements/,
      );
    }
  });

  it('requires every named required job to be completed successfully', () => {
    for (const requiredName of [
      'root-tests', 'flutter-quality', 'critical-journeys',
      'firestore-rules', 'release-policy',
    ]) {
      const failed = requiredJobs.map((job) => job.name === requiredName
        ? { ...job, conclusion: 'failure' }
        : job);
      const cancelled = requiredJobs.map((job) => job.name === requiredName
        ? { ...job, conclusion: 'cancelled' }
        : job);
      const skipped = requiredJobs.map((job) => job.name === requiredName
        ? { ...job, conclusion: 'skipped' }
        : job);
      const missing = requiredJobs.filter((job) => job.name !== requiredName);
      const unfinished = requiredJobs.map((job) => job.name === requiredName
        ? { ...job, status: 'in_progress', conclusion: null }
        : job);
      for (const jobs of [failed, cancelled, skipped, missing, unfinished]) {
        assert.throws(
          () => validateSourceRun(run, jobs, expected),
          /source workflow run did not meet publishing requirements/,
        );
      }
    }
  });
});
