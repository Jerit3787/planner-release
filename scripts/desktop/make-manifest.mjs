// Writes desktop.json and its Ed25519 signature for the Windows and Linux
// apps' update check (planner desktop design, 2026-11-22).
//
// The app downloads desktop.json and desktop.json.sig from the
// `desktop-channel` release, verifies the signature with the public key built
// into it, and refuses any download whose SHA-256 differs from the one listed
// here. The private key never leaves the DESKTOP_UPDATE_SIGNING_KEY secret.
//
// Each build carries the same build number as the Apple builds of that
// dispatch, 3.0.0 (4601), so a rebuild of one version is still an update; a
// manifest that isn't newer than the channel's current one is refused, as
// installed copies would never take it (desktop build numbers, 2026-11-23).
//
//   node scripts/desktop/make-manifest.mjs --version 3.0.0 --build 4601 \
//     --notes-file notes.txt --asset windows-x64=<url>=<sha256> [--asset ...] \
//     [--previous current-desktop.json] \
//     --key-env DESKTOP_UPDATE_SIGNING_KEY --out dist
import { createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The downloads the app knows how to install, by its own key. */
export const PLATFORM_KEYS = [
    'windows-x64', 'linux-x64-appimage', 'linux-arm64-appimage', 'linux-x64-deb', 'linux-arm64-deb',
];

function buildNumber(build) {
    if (!/^[1-9]\d*$/.test(String(build)) || !Number.isSafeInteger(Number(build))) {
        throw new Error(`bad build number: ${build}`);
    }
    return Number(build);
}

/** [version, build] for comparing; a manifest from before build numbers is build 0. */
function rank({ version, build }) {
    const parts = String(version).split('.').map(Number);
    return [...parts, Number.isSafeInteger(build) ? build : 0];
}

/** Throws unless [next] is a later release than [previous] (null or {}: none yet). */
export function assertNewer(previous, next) {
    if (!previous?.version) return;
    const a = rank(next);
    const b = rank(previous);
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            if (a[i] > b[i]) return;
            break;
        }
    }
    const label = (m) => `${m.version} (${m.build ?? 0})`;
    throw new Error(`${label(next)} is not newer than the channel's ${label(previous)}`);
}

/** The manifest object; throws on anything the app would refuse. */
export function buildManifest({ version, build, notes, assets, now = new Date() }) {
    if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`bad version: ${version}`);
    const number = buildNumber(build);
    const checked = {};
    for (const [key, value] of Object.entries(assets)) {
        if (!PLATFORM_KEYS.includes(key)) throw new Error(`unknown platform key: ${key}`);
        if (typeof value?.url !== 'string' || !value.url) throw new Error(`missing url for ${key}`);
        if (!/^[0-9a-f]{64}$/.test(String(value.sha256))) throw new Error(`bad sha256 for ${key}`);
        checked[key] = { url: value.url, sha256: value.sha256 };
    }
    return {
        version: String(version),
        build: number,
        notes: String(notes ?? ''),
        publishedAt: now.toISOString(),
        assets: checked,
    };
}

function privateKey(keyBase64) {
    return createPrivateKey(Buffer.from(keyBase64, 'base64').toString('utf8'));
}

/** Base64 Ed25519 signature of [bytes] with the PKCS8 PEM in [keyBase64]. */
export function sign(bytes, keyBase64) {
    return edSign(null, bytes, privateKey(keyBase64)).toString('base64');
}

/** The raw 32-byte public key, base64, as the app embeds it. */
export function rawPublicKey(keyBase64) {
    const der = createPublicKey(privateKey(keyBase64)).export({ type: 'spki', format: 'der' });
    return der.subarray(der.length - 32).toString('base64');
}

export function writeManifest({ version, build, notes, assets, keyBase64, out, now, previous = null }) {
    const manifest = buildManifest({ version, build, notes, assets, now });
    assertNewer(previous, manifest);
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'desktop.json'), bytes);
    writeFileSync(join(out, 'desktop.json.sig'), `${sign(bytes, keyBase64)}\n`);
}

function cli(argv) {
    const args = { assets: {} };
    for (let i = 0; i < argv.length; i += 2) {
        const [flag, value] = [argv[i], argv[i + 1]];
        if (flag === '--asset') {
            const [key, url, sha256] = value.split('=');
            args.assets[key] = { url, sha256 };
        } else if (flag === '--version') args.version = value;
        else if (flag === '--build') args.build = value;
        else if (flag === '--previous') args.previous = JSON.parse(readFileSync(value, 'utf8'));
        else if (flag === '--notes-file') args.notes = readFileSync(value, 'utf8').trim();
        else if (flag === '--key-env') args.keyBase64 = process.env[value];
        else if (flag === '--out') args.out = value;
        else throw new Error(`unknown flag: ${flag}`);
    }
    if (!args.keyBase64) throw new Error('the signing key is not set');
    writeManifest(args);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    try {
        cli(process.argv.slice(2));
    } catch (err) {
        console.error(`::error::${err.message}`);
        process.exit(1);
    }
}
