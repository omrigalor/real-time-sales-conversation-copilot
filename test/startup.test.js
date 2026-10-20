import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const failure of [false, true]) {
  test(failure ? 'startup: failed page load reports error and quits' : 'startup: module completes before ready and then opens its window', () => {
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('../scripts/check-startup.mjs', import.meta.url)), ...(failure ? ['--fail-load'] : [])], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });
}
