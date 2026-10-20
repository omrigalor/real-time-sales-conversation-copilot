// Run once from a normal macOS Terminal, not from the restricted coding workspace.
// This creates only this app's build identity; it never reads the saved OpenAI key.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { signingPaths, loadSigningIdentity, runPrivate, signBundle } from './local-signing.js';

export function setupIdentity() {
  const p = signingPaths();
  fs.mkdirSync(p.directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(p.directory, 0o700);
  if (!fs.existsSync(p.password)) fs.writeFileSync(p.password, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
  const password = fs.readFileSync(p.password, 'utf8');
  if (!fs.existsSync(p.keychain)) {
    // Creating a keychain may modify the search list. Restore that list immediately.
    const original = runPrivate('/usr/bin/security', ['list-keychains', '-d', 'user'], 'Reading the keychain search list');
    const searchList = [...original.matchAll(/"([^"]+)"/g)].map(match => match[1]);
    try { runPrivate('/usr/bin/security', ['create-keychain', '-p', password, p.keychain], 'Creating the isolated signing keychain'); }
    finally { if (searchList.length) runPrivate('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...searchList], 'Restoring the keychain search list'); }
  }
  fs.chmodSync(p.keychain, 0o600);
  runPrivate('/usr/bin/security', ['unlock-keychain', '-p', password, p.keychain], 'Unlocking the signing keychain');
  const privateKey = path.join(p.directory, 'pending-signer.key');
  const certificateRequest = path.join(p.directory, 'signer.cnf');
  const archive = path.join(p.directory, 'pending-signer.p12');
  // Resume partial setup with the same identity. Never regenerate a saved certificate.
  if (!fs.existsSync(p.certificate)) {
    if (fs.existsSync(privateKey)) throw new Error('Incomplete certificate setup found. Preserve the pending key and investigate before replacing the identity.');
    fs.writeFileSync(certificateRequest, `[req]\nprompt = no\ndistinguished_name = subject\nx509_extensions = extensions\n[subject]\nCN = SalesCopilot Local Build Signing\n[extensions]\nbasicConstraints = critical,CA:false\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = critical,codeSigning\n`, { mode: 0o600 });
    runPrivate('/usr/bin/openssl', ['req', '-new', '-newkey', 'rsa:3072', '-x509', '-nodes', '-days', '3650', '-config', certificateRequest, '-keyout', privateKey, '-out', p.certificate], 'Creating the local code-signing certificate');
    fs.chmodSync(privateKey, 0o600);
  }
  if (fs.existsSync(privateKey)) {
    runPrivate('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', privateKey, '-in', p.certificate, '-out', archive, '-passout', `file:${p.password}`], 'Preparing the signing identity import');
    fs.chmodSync(archive, 0o600);
    runPrivate('/usr/bin/security', ['import', archive, '-k', p.keychain, '-P', password, '-x', '-T', '/usr/bin/codesign'], 'Importing the non-extractable signing identity');
    fs.unlinkSync(privateKey); fs.unlinkSync(archive);
  }
  // This trust is for code signing only, in this user's domain; never TLS/system trust.
  console.log('macOS may request approval for the new local code-signing certificate.');
  runPrivate('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', '-k', p.keychain, p.certificate], 'Approving the local code-signing certificate', 120000);
  runPrivate('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:', '-s', '-k', password, p.keychain], 'Authorizing Apple signing tools for this isolated build key');
  return loadSigningIdentity();
}

export function verifyUpdateContinuity() {
  const directory = fs.mkdtempSync(path.join(signingPaths().directory, 'verify-update-'));
  const requirements = [];
  try {
    for (const version of ['1', '2']) {
      const bundle = path.join(directory, `Version${version}.app`);
      fs.mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
      fs.mkdirSync(path.join(bundle, 'Contents/Resources'));
      fs.copyFileSync('/usr/bin/true', path.join(bundle, 'Contents/MacOS/SigningProbe'));
      fs.chmodSync(path.join(bundle, 'Contents/MacOS/SigningProbe'), 0o700);
      fs.writeFileSync(path.join(bundle, 'Contents/Resources/build.txt'), version);
      fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.omrigalor.salescopilotfresh</string><key>CFBundleExecutable</key><string>SigningProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${version}</string></dict></plist>`);
      signBundle(bundle);
      const dr = runPrivate('/usr/bin/codesign', ['-d', '-r-', bundle], 'Reading the signed identity').trim();
      if (dr.includes('cdhash') || !dr.includes('designated =>')) throw new Error('Signing identity is still tied to one build. Repair stopped.');
      requirements.push(dr);
    }
    if (requirements[0] !== requirements[1]) throw new Error('Update identity changed. Repair stopped.');
    console.log('Verified: two different builds retain the same certificate-backed identity.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function repairInstalledApp() {
  const installed = path.join(os.homedir(), 'Applications/Sales Copilot Fresh.app');
  const staged = path.join(os.homedir(), 'Applications/SalesCopilot signing staging.app');
  const backup = `${installed}.before-signing-${Date.now()}`;
  if (!fs.existsSync(installed)) throw new Error('Installed SalesCopilot app was not found.');
  if (fs.existsSync(staged)) throw new Error('Previous signing staging folder exists; inspect it before retrying.');
  fs.cpSync(installed, staged, { recursive: true, verbatimSymlinks: true });
  try {
    signBundle(staged);
    fs.renameSync(installed, backup);
    try { fs.renameSync(staged, installed); }
    catch (error) { fs.renameSync(backup, installed); throw error; }
  } catch (error) { fs.rmSync(staged, { recursive: true, force: true }); throw error; }
  console.log(`Signed app installed. Previous app preserved at ${backup}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.umask(0o077);
    if (process.argv.includes('--repair-installed')) {
      const running = spawnSync('/usr/bin/pgrep', ['-f', '/Applications/Sales Copilot Fresh.app/Contents/MacOS/Sales Copilot Fresh']);
      if (running.status !== 1) throw new Error('Quit SalesCopilot with Command-Q before running this repair. Your call was not interrupted.');
    }
    setupIdentity();
    verifyUpdateContinuity();
    if (process.argv.includes('--repair-installed')) repairInstalledApp();
    console.log('Stable signing is ready. Future npm run package builds reuse this identity.');
    console.log('Reopen SalesCopilot. macOS may need one final Always Allow for the new identity.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
