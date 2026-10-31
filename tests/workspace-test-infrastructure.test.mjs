import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, chmod, lstat, writeFile, access, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import guard from '../scripts/workspace-test-environment.cjs';

const fixtureDirs = [];
const repo = path.resolve(import.meta.dirname, '..');
const runRoot = process.env.VANTILO_TEST_RUN_ROOT;

afterEach(async () => {
  for (const dir of fixtureDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('Workspace E2E run safety', () => {
  it('accepts only the recorded volume UUID, APFS and writable report', () => {
    const valid = `OK: Workspace UUID ${guard.EXPECTED_UUID} mounted at /Volumes/Workspace, APFS, writable`;
    expect(guard.assertWorkspaceVerifierReport(0, valid)).toBe(true);
    for (const [status, output] of [[1, valid], [0, valid.replace(guard.EXPECTED_UUID, 'wrong-id')], [0, valid.replace('APFS', 'HFS')], [0, valid.replace('writable', 'read-only')]]) {
      expect(() => guard.assertWorkspaceVerifierReport(status, output)).toThrow(/Workspace 身份/);
    }
  });

  it('rejects traversal and sibling-prefix paths', () => {
    expect(guard.isWithin('/Volumes/Workspace/test-runs', '/Volumes/Workspace/test-runs/run-a')).toBe(true);
    expect(guard.isWithin('/Volumes/Workspace/test-runs', '/Volumes/Workspace/test-runs-old/run-a')).toBe(false);
    expect(guard.isWithin('/Volumes/Workspace/test-runs', '/private/tmp/run-a')).toBe(false);
  });

  it('enforces the test-mode free-space threshold', () => {
    expect(guard.assertAvailableSpace(1024, 1024)).toBe(true);
    expect(() => guard.assertAvailableSpace(1023, 1024)).toThrow(/可用空间不足/);
  });

  it('checks target writability and rejects a real read-only target', async () => {
    const writable = await mkdtemp(path.join(os.tmpdir(), 'vantilo-e2e-write-probe-'));
    fixtureDirs.push(writable);
    expect(guard.assertWritableDirectory(writable)).toBe(true);
    const blocked = path.join(writable, 'read-only');
    await mkdir(blocked, { mode: 0o700 });
    await chmod(blocked, 0o500);
    try { expect(() => guard.assertWritableDirectory(blocked)).toThrow(/目标目录不可写/); }
    finally { await chmod(blocked, 0o700); }
  });

  it('fails closed when an E2E script is launched directly without the Workspace run marker', () => {
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/run-vocabulary-backup-e2e.mjs')], {
      cwd: repo,
      env: { PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
      encoding: 'utf8', timeout: 15000,
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('缺少 Workspace 独立运行目录');
  });

  it('rejects TMPDIR or HOME redirected outside this run', () => {
    const modulePath = path.join(repo, 'scripts/workspace-test-environment.cjs');
    const code = `require(${JSON.stringify(modulePath)}).assertWorkspaceTestEnvironment()`;
    const base = { ...process.env, VANTILO_TEST_RUN_ROOT: runRoot };
    const outsideTemp = spawnSync(process.execPath, ['-e', code], { cwd: repo, env: { ...base, TMPDIR: '/private/tmp' }, encoding: 'utf8' });
    expect(outsideTemp.status).not.toBe(0);
    expect(`${outsideTemp.stdout}\n${outsideTemp.stderr}`).toMatch(/TMPDIR/);
    const outsideHome = spawnSync(process.execPath, ['-e', code], { cwd: repo, env: { ...base, HOME: '/Users/world' }, encoding: 'utf8' });
    expect(outsideHome.status).not.toBe(0);
    expect(`${outsideHome.stdout}\n${outsideHome.stderr}`).toMatch(/HOME/);
  });

  it('rejects a Workspace path component that is a symlink to an external directory', async () => {
    const linked = path.join(runRoot, 'xdg-config-escape');
    await symlink('/private/tmp', linked, 'dir');
    fixtureDirs.push(linked);
    const modulePath = path.join(repo, 'scripts/workspace-test-environment.cjs');
    const code = `require(${JSON.stringify(modulePath)}).assertWorkspaceTestEnvironment()`;
    const result = spawnSync(process.execPath, ['-e', code], {
      cwd: repo, env: { ...process.env, XDG_CONFIG_HOME: linked }, encoding: 'utf8', timeout: 15000,
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/XDG_CONFIG_HOME|符号链接逃逸/);
  });

  it('retains bounded failure evidence and removes only owned large payload after failure', async () => {
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/run-tests-on-workspace.mjs'), '--node', 'scripts/test-fixtures/workspace-runner-failure.mjs'], {
      cwd: repo, env: process.env, encoding: 'utf8', timeout: 45000,
    });
    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    const root = output.match(/Vantilo isolated test run: (.+)/)?.[1]?.trim();
    expect(root?.startsWith(`${guard.RUNS_ROOT}/run-`)).toBe(true);
    const marker = JSON.parse(readFileSync(path.join(root, guard.OWNER_MARKER), 'utf8'));
    expect(marker.status).toBe('FAILED_CLEANED');
    expect(await access(path.join(root, 'temp', 'synthetic-failure-payload.bin')).then(() => true, () => false)).toBe(false);
    expect(await access(path.join(root, 'artifacts')).then(() => true, () => false)).toBe(false);
    expect(await readFile(path.join(root, 'results/artifacts/result-failure-fixture.json'), 'utf8')).toContain('SYNTHETIC_FAILURE_FIXTURE');
    expect(await readFile(path.join(root, 'logs/test-run.log'), 'utf8')).toContain('Intentional synthetic failure');
    const cleanup = spawnSync(process.execPath, [path.join(repo, 'scripts/cleanup-workspace-test-run.mjs'), '--run-id', path.basename(root)], { cwd: repo, env: process.env, encoding: 'utf8', timeout: 30000 });
    expect(cleanup.status).toBe(0);
    expect(await readFile(path.join(root, 'results/artifacts/result-failure-fixture.json'), 'utf8')).toContain('SYNTHETIC_FAILURE_FIXTURE');
  });

  it('cleans only one explicitly owned stale run and preserves that run’s logs/results', async () => {
    const runsRoot = guard.RUNS_ROOT;
    const runIdA = `run-20261031000000-999999-${crypto.randomUUID()}`;
    const runIdB = `run-20261031000001-999998-${crypto.randomUUID()}`;
    const rootA = path.join(runsRoot, runIdA), rootB = path.join(runsRoot, runIdB);
    fixtureDirs.push(rootA, rootB);
    const marker = (id, root) => ({ owner: 'vantilo-e2e-run-v1', ownerToken: crypto.randomUUID(), runId: id, runRoot: root, status: 'FAILED_CLEANED', wrapperPid: 999999999, wrapperStarted: null, childPid: null, childPgid: null });
    for (const [id, root] of [[runIdA, rootA], [runIdB, rootB]]) {
      await mkdir(path.join(root, 'artifacts'), { recursive: true, mode: 0o700 });
      await mkdir(path.join(root, 'logs'), { recursive: true, mode: 0o700 });
      await mkdir(path.join(root, 'results'), { recursive: true, mode: 0o700 });
      await writeFile(path.join(root, guard.OWNER_MARKER), JSON.stringify(marker(id, root)), { mode: 0o600 });
      await writeFile(path.join(root, 'artifacts', 'payload.bin'), 'synthetic');
      await writeFile(path.join(root, 'logs', 'test-run.log'), 'retained log');
      await writeFile(path.join(root, 'results', 'result.json'), 'retained result');
    }
    const cleanup = spawnSync(process.execPath, [path.join(repo, 'scripts/cleanup-workspace-test-run.mjs'), '--run-id', runIdA], { cwd: repo, env: process.env, encoding: 'utf8', timeout: 30000 });
    expect(cleanup.status).toBe(0);
    await expect(access(path.join(rootA, 'artifacts'))).rejects.toThrow();
    expect(await readFile(path.join(rootA, 'logs/test-run.log'), 'utf8')).toBe('retained log');
    expect(await readFile(path.join(rootA, 'results/result.json'), 'utf8')).toBe('retained result');
    await expect(access(path.join(rootB, 'artifacts/payload.bin'))).resolves.toBeUndefined();
    const cleanOther = spawnSync(process.execPath, [path.join(repo, 'scripts/cleanup-workspace-test-run.mjs'), '--run-id', runIdB], { cwd: repo, env: process.env, encoding: 'utf8', timeout: 30000 });
    expect(cleanOther.status).toBe(0);
  });
});
