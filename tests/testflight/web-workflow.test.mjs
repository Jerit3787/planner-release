import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

const workflow = JSON.parse(
  execFileSync(
    'ruby',
    [
      '-e',
      'require "json"; require "yaml"; puts JSON.generate(YAML.load_file(ARGV.fetch(0), aliases: true))',
      '.github/workflows/web.yml',
    ],
    { encoding: 'utf8' },
  ),
);

describe('Web deploy workflow contract', () => {
  const job = workflow.jobs.deploy;
  const steps = job.steps;
  const stepIndex = (name) => {
    const index = steps.findIndex((step) => step.name === name);
    assert.notEqual(index, -1, `missing step ${name}`);
    return index;
  };
  const script = (name) => steps[stepIndex(name)].run;

  it('is dispatch-only with the source commit and build number', () => {
    // YAML 1.1 reads the bare key `on` as true.
    const trigger = workflow.on ?? workflow[true];
    assert.deepEqual(Object.keys(trigger), ['workflow_dispatch']);
    for (const input of ['source_sha', 'build_number']) {
      assert.equal(trigger.workflow_dispatch.inputs[input].required, true);
      assert.equal(trigger.workflow_dispatch.inputs[input].type, 'string');
    }
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
  });

  it('checks every setting before it checks out or builds anything', () => {
    const check = script('Check the build settings are present');
    assert.equal(stepIndex('Check the build settings are present'), 0);
    for (const name of [
      'POWERSYNC_URL',
      'WORKER_URL',
      'GOOGLE_WEB_CLIENT_ID',
      'PLANNER_APPLE_SERVICES_ID',
      'PLANNER_APPCHECK_SITE_KEY',
    ]) {
      assert.match(check, new RegExp(`\\b${name}\\b`));
      assert.equal(job.env[name], `\${{ vars.${name} }}`);
    }
    assert.match(check, /\^\[0-9a-f\]\{40\}\$/);
    // The token's presence is checked without the token itself in the step.
    const env = steps[0].env;
    assert.equal(env.HAS_CLOUDFLARE_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN != '' }}");
  });

  it('builds the exact private commit with production settings and this build number', () => {
    const checkout = steps.find((step) => step.with?.repository === 'Jerit3787/planner');
    assert.equal(checkout.with.ref, '${{ inputs.source_sha }}');
    assert.equal(checkout.with['persist-credentials'], false);
    assert.match(
      script('Validate the production web release policy'),
      /release-policy\.mjs --environment prod --target web/,
    );
    const flutter = steps.find((step) => step.uses === 'subosito/flutter-action@v2.23.0');
    assert.equal(flutter.with['flutter-version'], '3.50.1');

    const build = script('Build the web app');
    for (const flag of [
      '--pwa-strategy=none',
      '--no-web-resources-cdn',
      '--build-number "$BUILD_NUMBER"',
      '--dart-define=PLANNER_ENV=prod',
      '--dart-define="PLANNER_APPCHECK_SITE_KEY=$PLANNER_APPCHECK_SITE_KEY"',
      '--dart-define="WORKER_URL=$WORKER_URL"',
      '--dart-define="POWERSYNC_URL=$POWERSYNC_URL"',
    ]) {
      assert.ok(build.includes(flag), `web build must pass ${flag}`);
    }
    const verify = script('Add the offline service worker and verify the build');
    assert.match(verify, /npm run build:pwa-worker[\s\S]*npm run verify:web -- app\/build\/web/);
  });

  it('deploys only after verification, and only the deploy step sees the Cloudflare token', () => {
    assert.ok(
      stepIndex('Deploy to Cloudflare') >
        stepIndex('Add the offline service worker and verify the build'),
    );
    const deploy = steps[stepIndex('Deploy to Cloudflare')];
    assert.equal(deploy['working-directory'], 'planner/app');
    assert.equal(deploy.env.CLOUDFLARE_API_TOKEN, '${{ secrets.CLOUDFLARE_API_TOKEN }}');
    assert.match(deploy.run, /npx wrangler deploy --message/);
    const tokenUses = JSON.stringify(workflow).match(/secrets\.CLOUDFLARE_API_TOKEN/g);
    assert.equal(tokenUses.length, 2, 'the token is read once to check it and once to deploy');
  });
});
