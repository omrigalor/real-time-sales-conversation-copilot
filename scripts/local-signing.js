// Stable, private local signing identity. Never use the application's API key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const signingDirectory = path.join(os.homedir(), '.local/share/salescopilot-signing');
export function signingPaths(directory = signingDirectory) {
  return { directory, keychain: path.join(directory, 'build.keychain-db'),
    password: path.join(directory, 'keychain-password'), certificate: path.join(directory, 'signer.pem') };
}
export function loadSigningIdentity(directory = signingDirectory) {
  const p = signingPaths(directory);
  if (!fs.existsSync(p.certificate) || !fs.existsSync(p.keychain)) {
    throw new Error('Stable signing is not configured. Run node scripts/setup-local-signing.js. No temporary signature was substituted.');
  }
  for (const filename of [p.directory, p.password, p.keychain]) {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Signing material must be private to your macOS account.');
  }
  const certificate = new X509Certificate(fs.readFileSync(p.certificate));
  const fingerprint = certificate.fingerprint.replaceAll(':', '').toUpperCase();
  if (Date.parse(certificate.validTo) <= Date.now()) throw new Error('Local signing certificate expired. Do not silently replace it.');
  return { ...p, fingerprint };
}
// execFileSync exceptions can contain arguments. Do not propagate passwords in errors.
export function runPrivate(command, args, label, timeout = 60000) {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }); }
  catch (error) {
    const detail = command === '/usr/bin/codesign' ? String(error.stderr || '').trim().slice(0,1600) : '';
    throw new Error(`${label} failed.${detail ? '\n' + detail : ' No credentials were printed.'}`);
  }
}
export function signBundle(bundle, directory = signingDirectory) {
  const p = loadSigningIdentity(directory);
  runPrivate('/usr/bin/security', ['unlock-keychain', '-p', fs.readFileSync(p.password, 'utf8'), p.keychain], 'Unlocking the isolated build keychain');
  // Include the keychain for identity and chain lookup, then restore the user's list.
  const original=runPrivate('/usr/bin/security',['list-keychains','-d','user'],'Reading signing search list');
  const list=[...original.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
  if(!list.length)throw new Error('Could not safely read the keychain search list.');
  try {
    runPrivate('/usr/bin/security',['list-keychains','-d','user','-s',...new Set([...list,p.keychain])],'Including the signing keychain');
    runPrivate('/usr/bin/codesign', ['--force', '--deep', '--timestamp=none', '--keychain', p.keychain, '--sign', p.fingerprint, bundle], 'Signing the application');
  } finally {
    runPrivate('/usr/bin/security',['list-keychains','-d','user','-s',...list],'Restoring signing search list');
  }
  runPrivate('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], 'Signature verification');
  // Pin the actual certificate, not just an impersonable bundle identifier.
  runPrivate('/usr/bin/codesign', ['--verify', '-R', `=certificate leaf = H"${p.fingerprint}" and identifier "com.omrigalor.salescopilotfresh"`, bundle], 'Persistent signer verification');
}
