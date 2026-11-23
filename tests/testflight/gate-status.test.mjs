import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { gateStatus } from '../../scripts/testflight/gate-status.mjs';

const gateNames = [
  'Flutter lint',
  'Flutter tests (shard 0 of 4)',
  'Flutter tests (shard 1 of 4)',
  'Flutter tests (shard 2 of 4)',
  'Flutter tests (shard 3 of 4)',
];

function job(name, status = 'completed', conclusion = 'success') {
  return { name, status, conclusion: status === 'completed' ? conclusion : null };
}

const allPassed = () => gateNames.map((name) => job(name));

describe('Flutter gate status', () => {
  it('passes when lint and all four shards succeeded', () => {
    assert.equal(gateStatus(allPassed()), 'passed');
  });

  it('is pending while any gate job is queued or running', () => {
    for (const status of ['queued', 'in_progress', 'waiting']) {
      const jobs = allPassed();
      jobs[2] = job(gateNames[2], status);
      assert.equal(gateStatus(jobs), 'pending', status);
    }
  });

  it('is pending while a gate job has not appeared yet', () => {
    assert.equal(gateStatus(allPassed().slice(0, 4)), 'pending');
    assert.equal(gateStatus([]), 'pending');
  });

  it('fails as soon as any gate job ends in failure, cancelled or skipped', () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
      const jobs = allPassed().slice(0, 3);
      jobs[1] = job(gateNames[1], 'completed', conclusion);
      assert.equal(gateStatus(jobs), 'failed', conclusion);
    }
  });

  it('ignores jobs that are not part of the gate', () => {
    const jobs = [
      ...allPassed(),
      job('build-upload (ios)', 'in_progress'),
      job('desktop', 'completed', 'failure'),
    ];
    assert.equal(gateStatus(jobs), 'passed');
  });

  it('counts shards by exact name, not by prefix', () => {
    const jobs = allPassed();
    jobs[4] = job('Flutter tests (shard 4 of 4)');
    assert.equal(gateStatus(jobs), 'pending');
  });

  it('reads the jobs API response on stdin and prints the status', () => {
    const output = execFileSync('node', ['scripts/testflight/gate-status.mjs'], {
      input: JSON.stringify({ total_count: 5, jobs: allPassed() }),
      encoding: 'utf8',
    });
    assert.equal(output.trim(), 'passed');
  });
});
