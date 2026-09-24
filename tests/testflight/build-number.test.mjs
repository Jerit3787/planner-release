import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeTestFlightBuildNumber } from '../../scripts/testflight/build-number.mjs';

describe('computeTestFlightBuildNumber', () => {
  it('uses one numeric value for the same workflow run and attempt', () => {
    assert.equal(computeTestFlightBuildNumber('1', '1'), '101');
    assert.equal(computeTestFlightBuildNumber(27, 3), '2703');
  });

  it('keeps reruns unique and a new run greater than the prior run', () => {
    const builds = [
      computeTestFlightBuildNumber(19, 1),
      computeTestFlightBuildNumber(19, 2),
      computeTestFlightBuildNumber(19, 51),
      computeTestFlightBuildNumber(20, 1),
    ];
    assert.deepEqual(builds, ['1901', '1902', '1951', '2001']);
    assert.equal(new Set(builds).size, builds.length);
    assert.ok(Number(builds[3]) > Number(builds[2]));
  });

  it('rejects malformed, zero, unsafe, or out-of-range metadata', () => {
    for (const [runNumber, runAttempt] of [
      ['', '1'], ['0', '1'], ['1.5', '1'], ['1e2', '1'],
      ['1', '0'], ['1', '52'], ['9007199254740992', '1'],
    ]) {
      assert.throws(
        () => computeTestFlightBuildNumber(runNumber, runAttempt),
        /invalid GitHub Actions run metadata/,
      );
    }
  });
});
