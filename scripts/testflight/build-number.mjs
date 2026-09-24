import { pathToFileURL } from 'node:url';

const maximumAttempt = 51;

function positiveSafeInteger(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function computeTestFlightBuildNumber(runNumber, runAttempt) {
  const run = positiveSafeInteger(runNumber);
  const attempt = positiveSafeInteger(runAttempt);
  const result = run === null || attempt === null ? NaN : run * 100 + attempt;

  if (
    run === null ||
    attempt === null ||
    attempt > maximumAttempt ||
    !Number.isSafeInteger(result)
  ) {
    throw new Error('invalid GitHub Actions run metadata');
  }

  return String(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${computeTestFlightBuildNumber(process.argv[2], process.argv[3])}\n`,
    );
  } catch {
    process.stderr.write(
      'testflight build number: invalid GitHub Actions run metadata\n',
    );
    process.exitCode = 1;
  }
}
