// One-command deploy of SpatialDesk to AWS (us-east-1), then an end-to-end check against production.
//   node scripts/deploy.mjs
// Needs: AWS CLI v2 with credentials, Docker running, JDK 17. Node only (no PowerShell quirks).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const server = join(root, 'server');
const infra = join(server, 'infra');
const win = process.platform === 'win32';
const gradle = `"${join(server, win ? 'gradlew.bat' : 'gradlew')}"`; // absolute: cmd skips the cwd on this machine
const awsCli = win && existsSync('C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe') ? '"C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe"' : 'aws';
const run = (cmd, cwd = root, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
const step = (m) => console.log(`\n==> ${m}`);

step('AWS identity');
const account = JSON.parse(execSync(`${awsCli} sts get-caller-identity --output json`, { encoding: 'utf-8' })).Account;
console.log(`account ${account}`);

step('Frontend: typecheck + production build');
run('npm run typecheck');
run('npm run build');

step('Backend: tests + jar');
run(`${gradle} --console=plain -q :shared:jvmTest :app:test :app:bootJar :infra:test`, server);

step('CDK deploy (stack SpatialDesk)');
run('npx --yes aws-cdk@2 deploy SpatialDesk --require-approval never --outputs-file cdk-outputs.json', infra, {
  CDK_DEFAULT_ACCOUNT: account,
  CDK_DEFAULT_REGION: 'us-east-1',
});
const url = JSON.parse(readFileSync(join(infra, 'cdk-outputs.json'), 'utf-8')).SpatialDesk.AppUrl;
console.log(`\nApp URL: ${url}`);

step('Waiting for the command server behind CloudFront');
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`${url}/api/sessions`, { method: 'POST' });
    if (res.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 10_000));
}

step('End-to-end test against production');
run('npx playwright test tests/e2e.spec.ts', root, { E2E_URL: url });
console.log(`\nDone. ${url}`);
