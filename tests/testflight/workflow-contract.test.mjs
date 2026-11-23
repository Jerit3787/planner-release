import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // Desktop builds share this run's build number, 3.0.0 (4601), when the
  // dispatch asks for them (desktop build numbers, 2026-11-23).
  it('dispatches the desktop build with its own build number when given notes', () => {
    const trigger = publishingWorkflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1];
    assert.match(
      trigger,
      /^      desktop_notes:\n        description:[^\n]+\n        required: false\n        default: ''\n        type: string$/m,
    );
    const desktop = parsedPublishingWorkflow.jobs.desktop;
    assert.ok(desktop, 'missing desktop job');
    assert.deepEqual(desktop.needs, [
      'verify-source',
      'validate-production-policy',
      'flutter-lint',
      'flutter-tests',
    ]);
    assert.match(desktop.if, /github\.ref == 'refs\/heads\/main'/);
    assert.match(desktop.if, /inputs\.desktop_notes != ''/);
    // The gate jobs skip when the private run was verified, and a skipped
    // need would skip desktop too, so its condition names every outcome.
    assert.match(desktop.if, /^\$\{\{ !cancelled\(\) && /);
    assert.match(desktop.if, /needs\.validate-production-policy\.result == 'success'/);
    assert.match(
      desktop.if,
      /\(needs\.flutter-lint\.result == 'success' && needs\.flutter-tests\.result == 'success'\)/,
    );
    assert.match(
      desktop.if,
      /\(!inputs\.local_verification && needs\.flutter-lint\.result == 'skipped' && needs\.flutter-tests\.result == 'skipped'\)/,
    );
    assert.deepEqual(desktop.permissions, { actions: 'write', contents: 'read' });
    const script = desktop.steps.map((step) => step.run ?? '').join('\n');
    assert.match(
      script,
      /node scripts\/testflight\/build-number\.mjs "\$GITHUB_RUN_NUMBER" "\$GITHUB_RUN_ATTEMPT"/,
    );
    assert.match(script, /actions\/workflows\/desktop\.yml\/dispatches/);
    for (const input of ['source_sha', 'build_number', 'notes']) {
      assert.match(script, new RegExp(`inputs\\[${input}\\]=`));
    }
    // The Apple job computes its number the same way, from the same run.
    assert.match(
      buildUpload,
      /node scripts\/testflight\/build-number\.mjs "\$GITHUB_RUN_NUMBER" "\$GITHUB_RUN_ATTEMPT"/,
    );
  });

  const verifySource = jobBlock(publishingWorkflow, 'verify-source');
  const buildUpload = jobBlock(publishingWorkflow, 'build-upload');

  it('is dispatch-only with all four required source-run inputs', () => {
    const trigger = publishingWorkflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1];
    assert.ok(trigger, 'workflow must declare triggers before permissions');
    assert.match(trigger, /^  workflow_dispatch:\n    inputs:/m);
    assert.doesNotMatch(trigger, /^  (?!workflow_dispatch:)[a-z_]+:/m);

    for (const input of ['source_ref', 'source_sha']) {
      assert.match(
        trigger,
        new RegExp(`^      ${input}:\\n        description:[^\\n]+\\n        required: true\\n        type: string$`, 'm'),
      );
    }

    for (const input of ['source_run_id', 'source_run_attempt']) {
      assert.match(
        trigger,
        new RegExp(`^      ${input}:\\n        description:[^\\n]+\\n        required: false\\n        default: '0'\\n        type: string$`, 'm'),
      );
    }

    assert.match(
      trigger,
      /^      local_verification:\n        description:[^\n]+\n        required: false\n        default: false\n        type: boolean$/m,
    );
    assert.match(publishingWorkflow, /^permissions:\n  contents: read$/m);
    assert.match(verifySource, /if:\s*\$\{\{\s*github\.ref == 'refs\/heads\/main'\s*\}\}/);
    assert.match(buildUpload, /if:\s*\$\{\{\s*github\.ref == 'refs\/heads\/main'\s*\}\}/);
  });

  it('can run the Flutter gate here, in its own jobs, when the private run is unavailable', () => {
    const verifyStep = parsedPublishingWorkflow.jobs['verify-source'].steps.find(
      (step) => step.name === 'Verify the exact private source run and required checks',
    );
    assert.ok(verifyStep, 'the private source verification step must exist');
    assert.equal(verifyStep.if, '${{ !inputs.local_verification }}');

    for (const id of ['flutter-lint', 'flutter-tests']) {
      const job = parsedPublishingWorkflow.jobs[id];
      assert.ok(job, `missing job ${id}`);
      assert.equal(job.needs, 'verify-source');
      assert.equal(job.if, "${{ github.ref == 'refs/heads/main' && inputs.local_verification }}");
      assert.equal(job['runs-on'], 'ubuntu-latest');
      assert.equal(job.environment, undefined, `${id} must not see the testflight environment`);

      const checkout = job.steps.find((step) => step.with?.repository === 'Jerit3787/planner');
      assert.ok(checkout, `${id} must check out the private planner revision`);
      assert.equal(checkout.with.ref, '${{ inputs.source_sha }}');
      assert.equal(checkout.with.token, '${{ secrets.PLANNER_PAT }}');
      assert.equal(checkout.with['persist-credentials'], false);

      const flutterSetup = job.steps.find((step) => step.uses === 'subosito/flutter-action@v2.23.0');
      assert.ok(flutterSetup, `${id} must set up Flutter`);
      assert.equal(flutterSetup.with['flutter-version'], '3.50.1');
      assert.equal(flutterSetup.with.cache, true);

      // tray_manager 0.9 / window_manager 0.7 build cnativeapi for the host
      // during flutter test, and on Linux that needs GTK 3, X11 and Xi.
      const libsIndex = job.steps.findIndex(
        (step) => step.name === 'Install the Linux libraries the desktop plugins build against',
      );
      assert.ok(libsIndex >= 0, `${id} must install the desktop plugins' Linux libraries`);
      for (const pkg of ['libgtk-3-dev', 'libx11-dev', 'libxi-dev']) {
        assert.match(job.steps[libsIndex].run, new RegExp(pkg));
      }
      const gateIndex = job.steps.findIndex((step) => /\bflutter\b/.test(step.run ?? ''));
      assert.ok(gateIndex > libsIndex, `${id} installs the libraries before Flutter runs`);
      assert.equal(job.steps[gateIndex]['working-directory'], 'planner/app');
    }

    const lint = parsedPublishingWorkflow.jobs['flutter-lint'];
    assert.equal(lint.name, 'Flutter lint');
    const lintScript = lint.steps.map((step) => step.run ?? '').join('\n');
    for (const command of [
      /flutter pub get/,
      /dart format --output=none --set-exit-if-changed lib test test_driver integration_test tool/,
      /flutter analyze/,
    ]) {
      assert.match(lintScript, command);
    }
    assert.doesNotMatch(lintScript, /flutter test/);

    const tests = parsedPublishingWorkflow.jobs['flutter-tests'];
    assert.equal(tests.name, 'Flutter tests (shard ${{ matrix.shard }} of 4)');
    assert.deepEqual(tests.strategy.matrix.shard, [0, 1, 2, 3]);
    assert.equal(tests.strategy['fail-fast'], false);
    const testScript = tests.steps.map((step) => step.run ?? '').join('\n');
    assert.match(
      testScript,
      /flutter test --concurrency=1 --total-shards=4 --shard-index=\$\{\{ matrix\.shard \}\}/,
    );

    // Policy is a sub-second check and gates signing; the test gate is not.
    const policySteps = parsedPublishingWorkflow.jobs['validate-production-policy'].steps;
    assert.ok(!policySteps.some((step) => /flutter-action/.test(step.uses ?? '')));
    assert.ok(!policySteps.some((step) => /\bflutter\b/.test(step.run ?? '')));
  });

  it('enables the pinned Flutter action cache for the SDK and pub dependencies', () => {
    const flutterSetup = parsedPublishingWorkflow.jobs['build-upload'].steps.find(
      (step) => step.name === 'Set up Flutter 3.50.1',
    );

    assert.ok(flutterSetup, 'the pinned Flutter setup step must exist');
    assert.equal(flutterSetup.uses, 'subosito/flutter-action@v2.23.0');
    assert.equal(flutterSetup.with.cache, true);
  });

  it('restores SwiftPM dependencies before either Apple build using lockfile-based keys', () => {
    const steps = parsedPublishingWorkflow.jobs['build-upload'].steps;
    const cacheIndex = steps.findIndex(
      (step) => step.name === 'Cache Swift Package Manager dependencies',
    );

    assert.notEqual(cacheIndex, -1, 'the SwiftPM cache step must exist');
    const cacheStep = steps[cacheIndex];
    assert.equal(cacheStep.uses, 'actions/cache@v6');
    assert.equal(cacheStep.with.path, '~/Library/Caches/org.swift.swiftpm');
    assert.match(
      cacheStep.with.key,
      /^\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-swiftpm-\$\{\{ matrix\.platform \}\}-\$\{\{ hashFiles\('planner\/app\/\*\*\/Package\.resolved'\) \}\}$/,
    );
    assert.match(
      cacheStep.with['restore-keys'],
      /^\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-swiftpm-\$\{\{ matrix\.platform \}\}-\n?$/,
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
    // Apple silicon: the macOS leg (41 min on Intel in trial 1) is the
    // critical path, and the macOS package is universal either way.
    assert.match(buildUpload, /runs-on:\s*macos-26\s*$/m);
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
      5,
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
      'TESTFLIGHT_IOS_WIDGET_PROFILE_BASE64',
      'TESTFLIGHT_MACOS_PROFILE_BASE64',
    ]) {
      assert.match(buildUpload, new RegExp(`secrets\\.${secret}`));
      assert.doesNotMatch(verifySource, new RegExp(`secrets\\.${secret}`));
    }

    assert.doesNotMatch(publishingWorkflow, /id-token:\s*write/i);
    // Only the desktop hand-off may start a workflow, and it holds no
    // secrets: no PAT, no Apple material, just this run's token.
    const desktop = jobBlock(publishingWorkflow, 'desktop');
    assert.doesNotMatch(publishingWorkflow.replace(desktop, ''), /actions:\s*write/i);
    assert.doesNotMatch(desktop, /secrets\./);
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
      'TESTFLIGHT_IOS_WIDGET_PROFILE_BASE64',
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

  // The iOS app embeds FocusActivityWidget.appex, signed manually with its
  // own App Store profile (planner 7315c59c); TestFlight run 55 failed with
  // no profile for it.
  it('installs and removes the iOS widget extension profile', () => {
    const signingStart = buildUpload.indexOf(
      'name: Install temporary Apple signing credentials',
    );
    const signingEnd = buildUpload.indexOf('\n      - name:', signingStart + 1);
    const signingStep = buildUpload.slice(signingStart, signingEnd);
    assert.match(signingStep, /-z "\$TESTFLIGHT_IOS_WIDGET_PROFILE_BASE64"/);
    assert.match(signingStep, /testflight-ios-widget\.mobileprovision/);
    assert.match(
      signingStep,
      /install_profile \\\s*\n\s*"\$IOS_WIDGET_PROFILE_PATH"/,
    );
    for (const file of [
      'testflight-ios-widget.mobileprovision',
      'testflight-ios-widget-profile.plist',
      'testflight-ios-widget-profile-uuid.txt',
    ]) {
      assert.match(buildUpload, new RegExp(`rm -f[\\s\\S]*"\\$RUNNER_TEMP/${file.replace(/\./g, '\\.')}"`));
    }
    assert.match(
      buildUpload,
      /for uuid_file in[\s\S]*testflight-ios-widget-profile-uuid\.txt/,
    );
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
    assert.match(buildUpload, /flutter-version:\s*['"]?3\.50\.1/);
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

    assert.match(buildUpload, /--build-number\s+"\$BUILD_NUMBER"/);
    // Both legs compute the number the same way, from the same run/attempt.
    assert.equal([...buildUpload.matchAll(/scripts\/testflight\/build-number\.mjs/g)].length, 1);

    const steps = parsedPublishingWorkflow.jobs['build-upload'].steps;
    const step = (name) => steps.find((candidate) => candidate.name === name);
    const locate = step('Locate the built IPA or macOS package');
    assert.ok(locate, 'the locate step must exist');
    assert.equal(locate.id, 'artifacts');
    assert.match(locate.run, /find build\/ios\/ipa -maxdepth 1 -type f -name '\*\.ipa'/);
    assert.match(locate.run, /find "\$RUNNER_TEMP\/macos-export" -maxdepth 1 -type f -name '\*\.pkg'/);
    assert.match(locate.run, /\(\( \$\{#files\[@\]\} != 1 \)\)/);

    for (const [name, type, other] of [
      ['Upload iOS/iPadOS to TestFlight', 'ios', 'macos'],
      ['Upload macOS to TestFlight', 'macos', 'ios'],
    ]) {
      const upload = step(name);
      assert.ok(upload, `missing ${name}`);
      assert.equal(upload.env.UPLOAD_FILE, '${{ steps.artifacts.outputs.file }}');
      assert.match(upload.run, new RegExp(`-f "\\$UPLOAD_FILE" \\\\\\s*\\n\\s*-t ${type} `));
      assert.doesNotMatch(upload.run, new RegExp(`-t ${other}\\b`));
      assert.match(upload.run, /-p @env:TESTFLIGHT_APP_SPECIFIC_PASSWORD/);
      assert.match(upload.run, /GITHUB_STEP_SUMMARY/);
    }
  });

  it('builds iOS and macOS as parallel legs that each sign and upload their own platform', () => {
    const job = parsedPublishingWorkflow.jobs['build-upload'];
    assert.deepEqual(job.strategy.matrix.platform, ['ios', 'macos']);
    assert.equal(job.strategy['fail-fast'], false);
    assert.deepEqual(job.permissions, { actions: 'read', contents: 'read' });
    assert.deepEqual(job.needs, ['verify-source', 'validate-production-policy']);

    const step = (name) => job.steps.find((candidate) => candidate.name === name);
    for (const [name, platform] of [
      ['Build the iOS/iPadOS TestFlight IPA', 'ios'],
      ['Upload iOS/iPadOS to TestFlight', 'ios'],
      ['Generate Flutter macOS archive configuration', 'macos'],
      ['Archive and export the macOS TestFlight package', 'macos'],
      ['Upload macOS to TestFlight', 'macos'],
    ]) {
      assert.equal(step(name)?.if, `\${{ matrix.platform == '${platform}' }}`, name);
    }
    for (const name of [
      'Resolve app version and TestFlight build number',
      'Validate all TestFlight environment inputs',
      'Install temporary Apple signing credentials',
      'Locate the built IPA or macOS package',
      'Remove temporary signing material and build output',
    ]) {
      assert.doesNotMatch(step(name)?.if ?? '', /matrix\.platform/, name);
    }
  });

  describe('uploads only after the Flutter gate passes', () => {
    const steps = parsedPublishingWorkflow.jobs['build-upload'].steps;
    const waitIndex = steps.findIndex((step) => step.name === 'Wait for the Flutter gate');
    const wait = steps[waitIndex];

    it('waits after building and before either upload, holding no secrets', () => {
      assert.ok(wait, 'the gate wait step must exist');
      assert.equal(wait.if, '${{ inputs.local_verification }}');
      assert.deepEqual(wait.env, { GH_TOKEN: '${{ github.token }}' });
      assert.doesNotMatch(JSON.stringify(wait), /secrets\./);
      assert.match(
        wait.run,
        /"repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$GITHUB_RUN_ID\/attempts\/\$GITHUB_RUN_ATTEMPT\/jobs\?per_page=100"/,
      );
      assert.match(wait.run, /node scripts\/testflight\/gate-status\.mjs/);
      assert.match(wait.run, /SECONDS \+ 3600/);

      const index = (name) => steps.findIndex((step) => step.name === name);
      for (const build of [
        'Build the iOS/iPadOS TestFlight IPA',
        'Archive and export the macOS TestFlight package',
        'Locate the built IPA or macOS package',
      ]) {
        assert.ok(index(build) < waitIndex, `${build} runs before the wait`);
      }
      for (const upload of ['Upload iOS/iPadOS to TestFlight', 'Upload macOS to TestFlight']) {
        assert.ok(index(upload) > waitIndex, `${upload} runs after the wait`);
      }
    });

    // Runs the step's own script with a stand-in gh and a sleep that only
    // advances bash's clock (ten minutes a poll), so the hour passes at once.
    function runWait(ghScript) {
      const dir = mkdtempSync(join(tmpdir(), 'gate-wait-'));
      try {
        const gh = join(dir, 'gh');
        writeFileSync(gh, `#!/bin/bash\n${ghScript}\n`);
        chmodSync(gh, 0o755);
        return spawnSync(
          'bash',
          ['-c', `sleep() { SECONDS=$((SECONDS + 600)); }\n${wait.run}`],
          {
            encoding: 'utf8',
            env: {
              PATH: `${dir}:${process.env.PATH}`,
              RUNNER_TEMP: dir,
              GITHUB_REPOSITORY: 'Jerit3787/planner-release',
              GITHUB_RUN_ID: '1',
              GITHUB_RUN_ATTEMPT: '1',
              GH_TOKEN: 'unused',
            },
          },
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const gateJob = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });
    const gateJobs = (shardConclusion = 'success') => JSON.stringify({
      jobs: [
        gateJob('Flutter lint'),
        ...[0, 1, 2, 3].map((shard) =>
          gateJob(`Flutter tests (shard ${shard} of 4)`, shard === 2 ? shardConclusion : 'success')),
      ],
    });

    it('goes on to upload once every gate job succeeded', () => {
      const result = runWait(`cat <<'JSON'\n${gateJobs()}\nJSON`);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });

    it('stops without uploading when a gate shard failed', () => {
      const result = runWait(`cat <<'JSON'\n${gateJobs('failure')}\nJSON`);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /::error::The Flutter gate failed/);
    });

    it('stops without uploading when the gate never finishes', () => {
      const pending = JSON.stringify({ jobs: [{ name: 'Flutter lint', status: 'in_progress', conclusion: null }] });
      const result = runWait(`cat <<'JSON'\n${pending}\nJSON`);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /::error::Timed out waiting for the Flutter gate/);
    });

    it('keeps waiting through API errors, saying so, and still times out', () => {
      const result = runWait('exit 4');
      assert.equal(result.status, 1);
      assert.match(result.stdout, /::warning::Could not read this run's gate jobs \(gh exit 4\)/);
      assert.match(result.stdout, /::error::Timed out waiting for the Flutter gate/);
    });

    it('says so when the jobs response cannot be read', () => {
      const result = runWait("echo 'not json'");
      assert.equal(result.status, 1);
      assert.match(result.stdout, /::warning::Could not read the gate status from this run's jobs/);
    });
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
  it('runs the contract and helper suite by hand only', () => {
    // Manual while Actions minutes are limited (2026-10-01).
    assert.match(validationWorkflow, /^on:\n  workflow_dispatch:\n/m);
    assert.doesNotMatch(validationWorkflow, /^  (pull_request|push):/m);
    assert.match(validationWorkflow, /runs-on:\s*ubuntu-latest/);
    assert.match(validationWorkflow, /node-version:\s*['"]?24/);
    assert.match(validationWorkflow, /node --test tests\/testflight\/\*\.test\.mjs/);
    assert.match(validationWorkflow, /ruby -e 'require "yaml"/);
    assert.match(validationWorkflow, /\.github\/workflows\/testflight\.yml/);
    assert.match(validationWorkflow, /\.github\/workflows\/testflight-validation\.yml/);
    assert.doesNotMatch(validationWorkflow, /secrets\.|environment:\s*testflight|TESTFLIGHT_/);
  });
});
