// Local STRUCTURAL validation of .github/workflows (not a GitHub execution). Run from anywhere.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
const repo = process.argv[2];
const require = createRequire(repo + '/package.json');
const yaml = require('js-yaml');
const dir = repo + '/.github/workflows';
const files = readdirSync(dir);
const docs = Object.fromEntries(files.map((f) => [f, yaml.load(readFileSync(`${dir}/${f}`, 'utf8'))]));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };
console.log('workflow files:', files.join(', '));
const wf = docs['ci.yml'];
const jobs = wf.jobs;
ok(files.length === 1 && files[0] === 'ci.yml', 'exactly one workflow file (no second publishing path)');
ok(Object.keys(wf.on).sort().join() === 'pull_request,push,workflow_dispatch', 'triggers are pull_request, push, workflow_dispatch (no pull_request_target / workflow_run)');
ok(JSON.stringify(wf.on.push.branches) === '["main"]', 'push trigger limited to main');
ok(JSON.stringify(wf.permissions) === '{"contents":"read"}', 'workflow default permissions: contents: read only');
ok(!('permissions' in jobs.check) && !('permissions' in jobs.e2e), 'check and e2e jobs have no extra permissions');
ok(JSON.stringify(jobs.deploy.permissions) === '{"contents":"read","pages":"write","id-token":"write"}', 'deploy job permissions: contents read, pages write, id-token write');
const writers = Object.entries(jobs).filter(([, j]) => j.permissions && (j.permissions.pages === 'write' || j.permissions['id-token'] === 'write')).map(([k]) => k);
ok(writers.join() === 'deploy', 'only the deploy job can write pages / mint the OIDC token');
ok(JSON.stringify(jobs.deploy.needs) === '["check","e2e"]', 'deploy needs check and e2e');
ok(jobs.e2e.needs === 'check', 'e2e needs check');
ok(JSON.stringify(jobs.e2e.strategy.matrix.project) === '["desktop","firefox","webkit","mobile"]', 'e2e matrix: desktop, firefox, webkit, mobile');
ok(jobs.e2e.strategy['fail-fast'] === false, 'matrix fail-fast: false (every leg reports)');
const run = (j) => j.steps.map((s) => s.run ?? '').join('\n');
for (const cmd of ['npm run typecheck', 'npm run lint', 'npm test', 'npm run build', 'npm audit --audit-level=low']) ok(run(jobs.check).includes(cmd), `check job runs: ${cmd}`);
ok(run(jobs.e2e).includes('npx playwright test --project=${{ matrix.project }}'), 'e2e job runs playwright for the matrix project');
ok(jobs.deploy.if === "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'", 'deploy condition: not a PR and ref is main');
ok(!/always\(\)|failure\(\)|cancelled\(\)/.test(String(jobs.deploy.if)), 'deploy condition has no status override (implicit success())');
const checkouts = Object.values(jobs).flatMap((j) => j.steps).filter((s) => String(s.uses).startsWith('actions/checkout'));
ok(checkouts.length === 2 && checkouts.every((s) => s.with?.ref === '${{ github.sha }}'), 'every checkout pins github.sha (the same immutable revision)');
ok(jobs.deploy.steps.every((s) => !String(s.uses ?? '').startsWith('actions/checkout')), 'deploy job checks out nothing (publishes the verified artifact only)');
const up = jobs.check.steps.find((s) => String(s.uses).startsWith('actions/upload-pages-artifact'));
ok(up && up.if.includes("refs/heads/main") && up.if.includes('pull_request'), 'verified build is packaged only on main (not PR)');
ok(wf.concurrency['cancel-in-progress'] === "${{ github.event_name == 'pull_request' }}", 'only pull-request runs may be cancelled by concurrency');
ok(jobs.check.name === 'Typecheck, lint, unit tests, build' && jobs.e2e.name === 'Browser tests (${{ matrix.project }})', 'existing job names preserved');

// Model of the gate (documents intent; GitHub evaluates the real thing): deploy runs iff its `if` holds AND all needs succeeded.
const gate = ({ event, ref, check, legs }) => {
  const ifOk = event !== 'pull_request' && ref === 'refs/heads/main';
  const e2e = check !== 'success' ? 'skipped' : legs.every((l) => l === 'success') ? 'success' : legs.includes('cancelled') && !legs.includes('failure') ? 'cancelled' : 'failure';
  return ifOk && check === 'success' && e2e === 'success';
};
const S = 'success';
const cases = [
  ['push to main, everything green', { event: 'push', ref: 'refs/heads/main', check: S, legs: [S, S, S, S] }, true],
  ['manual run on main, everything green', { event: 'workflow_dispatch', ref: 'refs/heads/main', check: S, legs: [S, S, S, S] }, true],
  ['pull request, everything green', { event: 'pull_request', ref: 'refs/pull/1/merge', check: S, legs: [S, S, S, S] }, false],
  ['manual run on a feature branch', { event: 'workflow_dispatch', ref: 'refs/heads/feature', check: S, legs: [S, S, S, S] }, false],
  ['manual run on a tag', { event: 'workflow_dispatch', ref: 'refs/tags/v0.1.1', check: S, legs: [S, S, S, S] }, false],
  ['main, check job failed (e2e skipped)', { event: 'push', ref: 'refs/heads/main', check: 'failure', legs: [] }, false],
  ['main, webkit leg failed', { event: 'push', ref: 'refs/heads/main', check: S, legs: [S, S, 'failure', S] }, false],
  ['main, mobile leg cancelled', { event: 'push', ref: 'refs/heads/main', check: S, legs: [S, S, S, 'cancelled'] }, false],
  ['main, run cancelled during check', { event: 'push', ref: 'refs/heads/main', check: 'cancelled', legs: [] }, false],
];
for (const [name, c, want] of cases) ok(gate(c) === want, `gate model: ${name} -> ${want ? 'publishes' : 'does NOT publish'}`);
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall structural checks passed (this is NOT a GitHub run)');
process.exit(failures ? 1 : 0);