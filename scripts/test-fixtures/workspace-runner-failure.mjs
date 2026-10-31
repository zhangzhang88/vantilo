import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import workspaceGuard from '../workspace-test-environment.cjs';

workspaceGuard.assertWorkspaceTestEnvironment();

const tempPayload = path.join(process.env.TMPDIR, 'synthetic-failure-payload.bin');
const result = path.join(process.env.VANTILO_TEST_ARTIFACT_ROOT, 'result-failure-fixture.json');
await writeFile(tempPayload, Buffer.alloc(2 * 1024 * 1024, 0x5a), { flag: 'wx', mode: 0o600 });
await writeFile(result, JSON.stringify({ status: 'SYNTHETIC_FAILURE_FIXTURE', tempPayload: path.basename(tempPayload) }) + '\n', { flag: 'wx', mode: 0o600 });
throw new Error('Intentional synthetic failure to verify owned-run cleanup and evidence retention.');
