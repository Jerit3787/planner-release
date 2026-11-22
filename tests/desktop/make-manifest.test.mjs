import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  assertNewer, buildManifest, PLATFORM_KEYS, rawPublicKey, sign, writeManifest,
} from '../../scripts/desktop/make-manifest.mjs';

// The Windows and Linux apps check desktop.json for updates and refuse any
// file whose signature or checksum doesn't match (planner desktop design,
// 2026-11-22).
const SHA = 'a'.repeat(64);
const asset = (url) => ({ url, sha256: SHA });

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { pemBase64: Buffer.from(pem).toString('base64'), publicKey };
}

test('signature verifies over the exact file bytes', () => {
  const { pemBase64, publicKey } = keys();
  const out = mkdtempSync(join(tmpdir(), 'manifest-'));
  writeManifest({
    version: '2.0.0',
    build: 4601,
    notes: 'First desktop release',
    assets: { 'windows-x64': asset('https://example/x.exe') },
    keyBase64: pemBase64,
    out,
    now: new Date('2026-11-22T10:00:00Z'),
  });
  const bytes = readFileSync(join(out, 'desktop.json'));
  const signature = Buffer.from(readFileSync(join(out, 'desktop.json.sig'), 'utf8'), 'base64');
  assert.equal(verify(null, bytes, publicKey, signature), true);
  assert.deepEqual(JSON.parse(bytes), {
    version: '2.0.0',
    build: 4601,
    notes: 'First desktop release',
    publishedAt: '2026-11-22T10:00:00.000Z',
    assets: { 'windows-x64': asset('https://example/x.exe') },
  });
  // A changed byte no longer verifies.
  const changed = Buffer.from(bytes);
  changed[10] ^= 1;
  assert.equal(verify(null, changed, publicKey, signature), false);
});

test('refuses an unknown platform key', () => {
  assert.throws(
    () => buildManifest({ version: '2.0.0', build: 1, notes: '', assets: { 'mac-arm64': asset('u') } }),
    /unknown platform key: mac-arm64/,
  );
});

test('refuses a sha256 that is not 64 hex characters', () => {
  assert.throws(
    () => buildManifest({ version: '2.0.0', build: 1, notes: '', assets: { 'windows-x64': { url: 'u', sha256: 'abc' } } }),
    /sha256/,
  );
});

test('refuses a version that is not x.y.z', () => {
  assert.throws(() => buildManifest({ version: 'v2', build: 1, notes: '', assets: {} }), /version/);
});

test('the platform keys are the five the app looks for', () => {
  assert.deepEqual(PLATFORM_KEYS, [
    'windows-x64', 'linux-x64-appimage', 'linux-arm64-appimage', 'linux-x64-deb', 'linux-arm64-deb',
  ]);
});

test('rawPublicKey gives the 32 bytes the app embeds', () => {
  const { pemBase64, publicKey } = keys();
  const raw = Buffer.from(rawPublicKey(pemBase64), 'base64');
  assert.equal(raw.length, 32);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  assert.deepEqual(raw, der.subarray(der.length - 32));
  assert.equal(typeof sign(Buffer.from('x'), pemBase64), 'string');
});

// Desktop builds carry Apple's build number, 3.0.0 (4601), so a rebuild of
// the same version is still an update (desktop build numbers, 2026-11-23).
test('refuses a build number that is not a positive whole number', () => {
  for (const build of [undefined, 0, -1, 1.5, '12a']) {
    assert.throws(() => buildManifest({ version: '3.0.0', build, notes: '', assets: {} }), /build/);
  }
  assert.equal(buildManifest({ version: '3.0.0', build: '4601', notes: '', assets: {} }).build, 4601);
});

test('a new manifest must be newer than the one on the channel', () => {
  const next = { version: '3.0.0', build: 4601 };
  assertNewer(null, next);
  // No channel yet.
  assertNewer({}, next);
  // The first desktop release had no build number.
  assertNewer({ version: '3.0.0' }, next);
  assertNewer({ version: '3.0.0', build: 4501 }, next);
  assertNewer({ version: '2.9.9', build: 9999 }, next);
  assert.throws(() => assertNewer({ version: '3.0.0', build: 4601 }, next), /not newer/);
  assert.throws(() => assertNewer({ version: '3.0.0', build: 4701 }, next), /not newer/);
  assert.throws(() => assertNewer({ version: '3.0.1', build: 1 }, next), /not newer/);
});
