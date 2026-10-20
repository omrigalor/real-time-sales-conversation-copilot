import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSigningIdentity, signBundle } from './local-signing.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A deliberate transitional build is permitted while local signing setup awaits
// the user. Normal builds must never silently revert to changing ad-hoc identities.
const temporaryRepairBuild = process.argv.includes('--pending-signing-repair');
if (!temporaryRepairBuild) loadSigningIdentity();
else console.warn('Temporary signature: Keychain repair remains pending. Do not report it as fixed.');
const apps = await packager({
  dir: root, out: path.join(root, 'dist'), name: 'Sales Copilot Fresh',
  appBundleId: 'com.omrigalor.salescopilotfresh', appVersion: '1.0.27',
  icon: path.join(root, 'assets', 'SalesCopilotFresh.icns'),
  platform: 'darwin', arch: 'arm64', overwrite: true, asar: true,
  ignore: [/^\/corpus($|\/)/, /^\/evaluation\/runs($|\/)/, /^\/test($|\/)/, /^\/test-results($|\/)/, /^\/backups($|\/)/, /^\/playwright/, /^\/scripts($|\/)/, /^\/\.git($|\/)/],
  extendInfo: { NSMicrophoneUsageDescription: 'Sales Copilot uses your microphone for voice practice and speakerphone coaching. Audio is sent to OpenAI only while a call session is running.', NSAudioCaptureUsageDescription: 'When you choose Call audio on Mac, SalesCopilot captures the selected Mac audio and your microphone for live coaching. Audio is sent to OpenAI while listening. No screen images are sent.' },
});
for (const dir of apps) {
  const bundle = path.join(dir, 'Sales Copilot Fresh.app');
  if (temporaryRepairBuild) execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
  else signBundle(bundle);
  console.log(bundle);
}
