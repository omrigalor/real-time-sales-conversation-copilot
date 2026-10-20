import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test', testMatch: '*.spec.js', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4197', viewport: { width: 1200, height: 820 },
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
  webServer: { command: 'node scripts/preview.js', url: 'http://127.0.0.1:4197', reuseExistingServer: false },
});
