import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const publishingWorkflow = readFileSync('.github/workflows/testflight.yml', 'utf8');
const validationWorkflow = readFileSync(
  '.github/workflows/testflight-validation.yml',
  'utf8',
);
const parsedPublishingWorkflow = JSON.parse(
  execFileSync(
    'ruby',
    [
      '-e',
      'require "json"; require "yaml"; puts JSON.generate(YAML.load_file(ARGV.fetch(0), aliases: true))',
      '.github/workflows/testflight.yml',
    ],
    { encoding: 'utf8' },
  ),
);

function jobBlock(workflow, id) {
  const start = workflow.search(new RegExp(`^  ${id}:\\n`, 'm'));
  assert.notEqual(start, -1, `missing job ${id}`);

  const remainder = workflow.slice(start);
  const nextJob = remainder.slice(1).search(/^  [a-z0-9_-]+:\s*$/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob + 1);
}

describe('TestFlight publishing workflow contract', () => {
  const verifySource = jobBlock(publishingWorkflow, 'verify-source');
  const buildUpload = jobBlock(publishingWorkflow, 'build-upload');

  it('is dispatch-only with all four required source-run inputs', () => {
    const trigger = publishingWorkflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1];
    assert.ok(trigger, 'workflow must declare triggers before permissions');
    assert.match(trigger, /^  workflow_dispatch:\n    inputs:/m);
    assert.doesNotMatch(trigger, /^  (?!workflow_dispatch:)[a-z_]+:/m);

    for (const input of [
      'source_ref',
      'source_sha',
      'source_run_id',
      'source_run_attempt',
    ]) {
      assert.match(
        trigger,
        new RegExp(`^      ${input}:\\n        description:[^\\n]+\\n        required: true\\n        type: string$`, 'm'),
      );
    }

    assert.match(publishingWorkflow, /^permissions:\n  contents: read$/m);
    assert.match(verifySource, /if:\s*\$\{\{\s*github\.ref == 'refs\/heads\/main'\s*\}\}/);
    assert.match(buildUpload, /if:\s*\$\{\{\s*github\.ref == 'refs\/heads\/main'\s*\}\}/);
  });

  it('enables the pinned Flutter action cache for the SDK and pub dependencies', () => {
    const flutterSetup = parsedPublishingWorkflow.jobs['build-upload'].steps.find(
      (step) => step.name === 'Set up Flutter 3.47.4',
    );

    assert.ok(flutterSetup, 'the pinned Flutter setup step must exist');
    assert.equal(flutterSetup.uses, 'subosito/flutter-action@v2.22.0');
    assert.equal(flutterSetup.with.cache, true);
  });

  it('restores SwiftPM dependencies before either Apple build using lockfile-based keys', () => {
    const steps = parsedPublishingWorkflow.jobs['build-upload'].steps;
    const cacheIndex = steps.findIndex(
      (step) => step.name === 'Cache Swift Package Manager dependencies',
    );

    assert.notEqual(cacheIndex, -1, 'the SwiftPM cache step must exist');
    const cacheStep = steps[cacheIndex];
    assert.equal(cacheStep.uses, 'actions/cache@v5');
    assert.equal(cacheStep.with.path, '~/Library/Caches/org.swift.swiftpm');
    assert.match(
      cacheStep.with.key,
      /^\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-swiftpm-\$\{\{ hashFiles\('planner\/app\/\*\*\/Package\.resolved'\) \}\}$/,
    );
    assert.match(
      cacheStep.with['restore-keys'],
      /^\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-swiftpm-\n?$/,
    );

    for (const buildName of [
      'Build the iOS/iPadOS TestFlight IPA',
      'Generate Flutter macOS archive configuration',
    ]) {
      const buildIndex = steps.findIndex((step) => step.name === buildName);
      assert.ok(buildIndex > cacheIndex, `SwiftPM cache must precede ${buildName}`);
    }
  });

  it('validates the exact source run before the Apple environment can start', () => {
    assert.match(verifySource, /runs-on:\s*ubuntu-latest/);
    assert.match(buildUpload, /runs-on:\s*macos-26-intel/);
    assert.match(buildUpload, /needs:\s*-\s*verify-source/);
    assert.match(buildUpload, /environment:\s*testflight/);
    assert.doesNotMatch(verifySource, /environment:\s*testflight/);
    assert.doesNotMatch(verifySource, /TESTFLIGHT_[A-Z0-9_]+/);

    for (const requirement of [
      /checkout the public release repository/i,
      /SECONDS\s*\+\s*600/,
      /sleep_for=15/,
      /repos\/Jerit3787\/planner\/actions\/runs\/\$SOURCE_RUN_ID/,
      /attempts\/\$SOURCE_RUN_ATTEMPT\/jobs\?per_page=100/,
      /validate-source-run\.mjs/,
      /"\$SOURCE_REF"\s+"\$SOURCE_SHA"\s+"\$SOURCE_RUN_ID"\s+"\$SOURCE_RUN_ATTEMPT"/,
      /SOURCE_REF.*== 'dev'/s,
      /\[\[ "\$SOURCE_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/,
      /\[\[ "\$SOURCE_RUN_ATTEMPT" =~ \^\(\[1-9\]\|\[1-4\]\[0-9\]\|5\[01\]\)\$ \]\]/,
    ]) {
      assert.match(verifySource, requirement);
    }
  });

  it('validates production App Check and desktop posture before Apple signing', () => {
    const productionPolicy = jobBlock(
      publishingWorkflow,
      'validate-production-policy',
    );

    assert.match(productionPolicy, /runs-on:\s*ubuntu-latest/);
    assert.match(productionPolicy, /needs:\s*verify-source/);
    assert.doesNotMatch(productionPolicy, /environment:\s*testflight/);
    assert.match(productionPolicy, /ref:\s*\$\{\{\s*inputs\.source_sha\s*\}\}/);
    assert.match(productionPolicy, /token:\s*\$\{\{\s*secrets\.PLANNER_PAT\s*\}\}/);
    assert.match(productionPolicy, /PLANNER_DESKTOP_POSTURE:\s*attested/);
    assert.match(
      productionPolicy,
      /node tools\/release\/release-policy\.mjs --environment prod --target ios/,
    );
    assert.match(
      productionPolicy,
      /node tools\/release\/release-policy\.mjs --environment prod --target macos/,
    );
    assert.match(
      buildUpload,
      /needs:\s*\n\s*- verify-source\s*\n\s*- validate-production-policy/,
    );
  });

  it('limits the private PAT and Apple secrets to their intended steps', () => {
    assert.match(verifySource, /GH_TOKEN:\s*\$\{\{\s*secrets\.PLANNER_PAT\s*\}\}/);
    assert.match(buildUpload, /token:\s*\$\{\{\s*secrets\.PLANNER_PAT\s*\}\}/);
    assert.equal(
      [...publishingWorkflow.matchAll(/secrets\.PLANNER_PAT/g)].length,
      3,
      'the private PAT must only be used for source metadata and source checkouts',
    );

    for (const secret of [
      'TESTFLIGHT_APPLE_ID',
      'TESTFLIGHT_APP_SPECIFIC_PASSWORD',
      'TESTFLIGHT_DISTRIBUTION_CERTIFICATE_P12_BASE64',
      'TESTFLIGHT_CERTIFICATE_PASSWORD',
      'TESTFLIGHT_INSTALLER_CERTIFICATE_P12_BASE64',
      'TESTFLIGHT_INSTALLER_CERTIFICATE_PASSWORD',
      'TESTFLIGHT_IOS_PROFILE_BASE64',
      'TESTFLIGHT_MACOS_PROFILE_BASE64',
    ]) {
      assert.match(buildUpload, new RegExp(`secrets\\.${secret}`));
      assert.doesNotMatch(verifySource, new RegExp(`secrets\\.${secret}`));
    }

    assert.doesNotMatch(publishingWorkflow, /id-token:\s*write|actions:\s*write/i);
  });

  it('checks all Apple secrets and production runtime variables before decoding signing material', () => {
    const preflightStart = buildUpload.indexOf('name: Validate all TestFlight environment inputs');
    const preflightEnd = buildUpload.indexOf('\n      - name:', preflightStart + 1);
    const firstDecode = buildUpload.indexOf('base64 -D');
    assert.ok(preflightStart >= 0 && preflightEnd > preflightStart);
    assert.ok(firstDecode > preflightEnd);

    const preflight = buildUpload.slice(preflightStart, preflightEnd);
    for (const secret of [
      'TESTFLIGHT_APPLE_ID',
      'TESTFLIGHT_APP_SPECIFIC_PASSWORD',
      'TESTFLIGHT_DISTRIBUTION_CERTIFICATE_P12_BASE64',
      'TESTFLIGHT_CERTIFICATE_PASSWORD',
      'TESTFLIGHT_INSTALLER_CERTIFICATE_P12_BASE64',
      'TESTFLIGHT_INSTALLER_CERTIFICATE_PASSWORD',
      'TESTFLIGHT_IOS_PROFILE_BASE64',
      'TESTFLIGHT_MACOS_PROFILE_BASE64',
    ]) {
      assert.match(preflight, new RegExp(`secrets\\.${secret}`));
      assert.match(preflight, new RegExp(`-z "\\$${secret}"`));
    }

    for (const value of ['POWERSYNC_URL', 'WORKER_URL', 'GOOGLE_WEB_CLIENT_ID']) {
      assert.match(preflight, new RegExp(`${value}: \\$\\{\\{ vars\\.${value} \\}\\}`));
      assert.match(preflight, new RegExp(`-z "\\$${value}"`));
    }
  });

  it('imports the separate macOS installer identity into the temporary keychain', () => {
    const signingStart = buildUpload.indexOf(
      'name: Install temporary Apple signing credentials',
    );
    const signingEnd = buildUpload.indexOf('\n      - name:', signingStart + 1);
    assert.ok(signingStart >= 0 && signingEnd > signingStart);

    const signingStep = buildUpload.slice(signingStart, signingEnd);
    assert.match(signingStep, /TESTFLIGHT_INSTALLER_CERTIFICATE_P12_BASE64/);
    assert.match(signingStep, /TESTFLIGHT_INSTALLER_CERTIFICATE_PASSWORD/);
    assert.match(signingStep, /testflight-installer\.p12/);
    assert.match(signingStep, /security import "\$INSTALLER_CERTIFICATE_PATH"/);
    assert.match(
      buildUpload,
      /rm -f[\s\S]*"\$RUNNER_TEMP\/testflight-installer\.p12"/,
    );
  });

  it('captures complete Xcode version output before parsing it', () => {
    const preflightStart = buildUpload.indexOf(
      'name: Check Xcode and App Store uploader support',
    );
    const preflightEnd = buildUpload.indexOf('\n      - name:', preflightStart + 1);
    assert.ok(preflightStart >= 0 && preflightEnd > preflightStart);

    const preflight = buildUpload.slice(preflightStart, preflightEnd);
    assert.match(preflight, /xcode_version_output="\$\(xcodebuild -version\)"/);
    assert.match(
      preflight,
      /xcode_version="\$\{xcode_version_output#Xcode \}"/,
    );
    assert.match(
      preflight,
      /xcode_version="\$\{xcode_version%%\$'\\n'\*\}"/,
    );
    assert.doesNotMatch(preflight, /xcodebuild -version\s*\|\s*awk/);
  });

  it('builds release apps with their required production runtime configuration', () => {
    const preflight = buildUpload.slice(
      buildUpload.indexOf('name: Validate all TestFlight environment inputs'),
      buildUpload.indexOf('\n      - name:', buildUpload.indexOf('name: Validate all TestFlight environment inputs') + 1),
    );

    for (const value of ['POWERSYNC_URL', 'WORKER_URL', 'GOOGLE_WEB_CLIENT_ID']) {
      assert.match(buildUpload, new RegExp(`${value}: \\$\\{\\{ vars\\.${value} \\}\\}`));
      assert.match(preflight, new RegExp(`-z "\\$${value}"`));
      assert.doesNotMatch(publishingWorkflow, new RegExp(`secrets\\.${value}`));
    }

    const iosBuildStart = buildUpload.indexOf('name: Build the iOS/iPadOS TestFlight IPA');
    const iosBuildEnd = buildUpload.indexOf('\n      - name:', iosBuildStart + 1);
    const iosBuild = buildUpload.slice(iosBuildStart, iosBuildEnd);
    assert.match(iosBuild, /--dart-define=PLANNER_ENV=prod/);
    assert.match(iosBuild, /--dart-define="POWERSYNC_URL=\$POWERSYNC_URL"/);
    assert.match(iosBuild, /--dart-define="WORKER_URL=\$WORKER_URL"/);
    assert.match(iosBuild, /--dart-define="GOOGLE_WEB_CLIENT_ID=\$GOOGLE_WEB_CLIENT_ID"/);

    const macBuildStart = buildUpload.indexOf('name: Archive and export the macOS TestFlight package');
    const macBuildEnd = buildUpload.indexOf('\n      - name:', macBuildStart + 1);
    const macBuild = buildUpload.slice(macBuildStart, macBuildEnd);
    assert.match(macBuild, /encode_define 'PLANNER_ENV=prod'/);
    assert.match(macBuild, /encode_define "POWERSYNC_URL=\$POWERSYNC_URL"/);
    assert.match(macBuild, /encode_define "WORKER_URL=\$WORKER_URL"/);
    assert.match(macBuild, /encode_define "GOOGLE_WEB_CLIENT_ID=\$GOOGLE_WEB_CLIENT_ID"/);
    assert.match(macBuild, /DART_DEFINES="\$DART_DEFINES"/);
  });

  it('generates production Flutter macOS archive configuration before Xcode archiving', () => {
    const configStart = buildUpload.indexOf(
      'name: Generate Flutter macOS archive configuration',
    );
    const archiveStart = buildUpload.indexOf(
      'name: Archive and export the macOS TestFlight package',
    );
    const configEnd = buildUpload.indexOf('\n      - name:', configStart + 1);
    assert.ok(configStart >= 0 && archiveStart > configStart);
    assert.ok(configEnd > configStart && configEnd < archiveStart);

    const configStep = buildUpload.slice(configStart, configEnd);
    for (const requirement of [
      /working-directory:\s*planner\/app/,
      /flutter build macos/,
      /--config-only/,
      /--release/,
      /--no-pub/,
      /--build-name "\$APP_VERSION"/,
      /--build-number "\$BUILD_NUMBER"/,
      /--dart-define=PLANNER_ENV=prod/,
      /--dart-define="POWERSYNC_URL=\$POWERSYNC_URL"/,
      /--dart-define="WORKER_URL=\$WORKER_URL"/,
      /--dart-define="GOOGLE_WEB_CLIENT_ID=\$GOOGLE_WEB_CLIENT_ID"/,
    ]) {
      assert.match(configStep, requirement);
    }
  });

  it('builds both tested Apple targets with one build number before uploading', () => {
    assert.match(buildUpload, /flutter-version:\s*['"]?3\.47\.4/);
    assert.match(buildUpload, /inputs\.source_sha/);
    assert.match(buildUpload, /scripts\/testflight\/build-number\.mjs/);
    assert.match(buildUpload, /ios\/ExportOptions\.testflight\.plist/);
    assert.match(buildUpload, /macos\/ExportOptions\.testflight\.plist/);
    assert.match(buildUpload, /xcodebuild[\s\S]*?archive/);
    assert.match(buildUpload, /xcodebuild[\s\S]*?exportArchive/);
    assert.match(buildUpload, /-t ios/);
    assert.match(buildUpload, /-t macos/);
    assert.match(buildUpload, /-p @env:TESTFLIGHT_APP_SPECIFIC_PASSWORD/);
    assert.match(buildUpload, /CURRENT_PROJECT_VERSION="\$BUILD_NUMBER"/);

    const ipaCheck = buildUpload.indexOf('ipas=()');
    const packageCheck = buildUpload.indexOf('packages=()');
    const iosUpload = buildUpload.indexOf('if xcrun altool --upload-app');
    const macUpload = buildUpload.indexOf('if xcrun altool --upload-app', iosUpload + 1);
    assert.ok(ipaCheck >= 0 && packageCheck > ipaCheck);
    assert.ok(iosUpload > packageCheck && macUpload > iosUpload);
    assert.ok(buildUpload.indexOf('-t ios', iosUpload) < macUpload);
    assert.ok(buildUpload.indexOf('-t macos', macUpload) > macUpload);
    assert.match(buildUpload, /--build-number\s+"\$BUILD_NUMBER"/);
  });

  it('reports platform outcomes separately and cleans signing material', () => {
    assert.match(buildUpload, /IOS_UPLOAD_STATUS/);
    assert.match(buildUpload, /MACOS_UPLOAD_STATUS/);
    assert.match(buildUpload, /if:\s*always\(\)/);
    assert.match(buildUpload, /security delete-keychain/);
    assert.match(buildUpload, /Provisioning Profiles/);
    assert.match(buildUpload, /rm -rf/);
    assert.doesNotMatch(publishingWorkflow, /upload-artifact|gh release|create-release/i);
  });
});

describe('TestFlight secret-free validation workflow', () => {
  it('runs the contract and helper suite on public PRs and main pushes', () => {
    assert.match(validationWorkflow, /^on:\n  pull_request:\n  push:\n    branches:\n      - main$/m);
    assert.match(validationWorkflow, /runs-on:\s*ubuntu-latest/);
    assert.match(validationWorkflow, /node-version:\s*['"]?24/);
    assert.match(validationWorkflow, /node --test tests\/testflight\/\*\.test\.mjs/);
    assert.match(validationWorkflow, /ruby -e 'require "yaml"/);
    assert.match(validationWorkflow, /\.github\/workflows\/testflight\.yml/);
    assert.match(validationWorkflow, /\.github\/workflows\/testflight-validation\.yml/);
    assert.doesNotMatch(validationWorkflow, /secrets\.|environment:\s*testflight|TESTFLIGHT_/);
  });
});
