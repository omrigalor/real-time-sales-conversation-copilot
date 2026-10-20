// Reproduce Electron's lifecycle: ready resolves only after the entry module finishes.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';
import { EventEmitter } from 'node:events';
import { installMediaPermissions } from '../media-permissions.js';

const failing = process.argv.includes('--fail-load');
let ready, windows = 0, loaded = '', quit = false, currentWindow;
const writes = [], deleted = [];
const dialogs = [], handlers = new Map();
const app = Object.assign(new EventEmitter(), {
  whenReady: () => new Promise(resolve => { ready = resolve; }),
  setName() {}, setPath() {}, getPath: () => '/test/copilot',
  quit: () => { quit = true; },
});
class BrowserWindow extends EventEmitter {
  constructor() { super(); windows++; currentWindow = this; this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} }); }
  loadURL(value) { loaded = value; return failing ? Promise.reject(new Error('Test: local page unavailable')) : Promise.resolve(); }
  static getAllWindows() { return [{}]; }
}
const dependencies = {
  electron: {
    app, BrowserWindow, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, net: {},
    session: { defaultSession: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, setDisplayMediaRequestHandler() {} } },
    safeStorage: {}, systemPreferences: {}, shell: { openPath: async () => '' },
    Menu: { setApplicationMenu() {}, buildFromTemplate: x => x },
    dialog: { showErrorBox: (title, message) => dialogs.push({ title, message }) },
  },
  'node:fs/promises': {
    readFile: async () => { throw new Error('ENOENT'); }, writeFile: async (file, data) => { writes.push({file,data}); }, mkdir: async () => {}, unlink: async file => { deleted.push(file); },
  },
  'node:path': { default: path }, 'node:url': url,
  './credential-store.js': {CredentialStore:class { constructor(){this.key='';}async load(){}status(){return {hasKey:false,saved:false,keyStorageState:'missing'};} }},
  './media-permissions.js': {installMediaPermissions},
  './buyer-voice-api.js': {createBuyerVoiceResolver:()=>async()=>undefined},
  './research-api.js': {researchAccount(){}},
  './product-focus-api.js': {assessProductFocus(){}},
  './handoff-api.js': {handoffCall(){}},
  './app/researched-target.js': {researchedTarget:()=>({company:'Target'})},
  './app/account-seeds.js': {updateResearchLibrary:value=>value},
  './call-lifecycle-api.js': {assessLifecycle(){}},
  './speaker-audio-api.js': {diarizeAudio(){}},
  './app/account-library.js': {inheritProfileVoice:value=>value,normalizeLibrary:()=>[],saveToLibrary:()=>[]},
  './app/call-context.js': {scopedSalesContext:()=>'', normalizeContextNotes:()=>({})},
  './app/account-context.js': {normalizeAccount:()=>null, publicURL:()=>''},
  './training-api.js': { observeTurn() {}, reviewCall() {} },
  './api.js': { connectOpenAI() {}, streamCoach() {}, MODELS: {} },
};
const context = vm.createContext({ process: { env: {} }, console, setTimeout, clearTimeout, AbortController, Response });
const moduleURL = new URL('../main.js', import.meta.url);
const source = await readFile(moduleURL, 'utf8');
const entry = new vm.SourceTextModule(source, { context, initializeImportMeta: meta => { meta.url = moduleURL.href; } });
await entry.link(specifier => {
  const values = dependencies[specifier];
  assert.ok(values, `Unexpected import: ${specifier}`);
  return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
});
let deadline;
try {
  await Promise.race([
    entry.evaluate(),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Startup deadlock: entry module waits for ready before it can finish loading')), 300); }),
  ]);
} finally { clearTimeout(deadline); }
assert.equal(windows, 0, 'Do not create windows before Electron is ready');
assert.equal(typeof ready, 'function');
ready();
await new Promise(resolve => setImmediate(resolve));
assert.equal(windows, 1, 'Ready must create a window');
assert.equal(loaded, 'copilot://app/');
assert.ok(handlers.has('settings:get'), 'Settings must be available when the window loads');
if (failing) {
  assert.equal(quit, true, 'A failed page load must quit instead of leaving a stuck app');
  assert.match(dialogs[0]?.message || '', /local page unavailable/);
} else {
  assert.equal(quit, false); assert.equal(dialogs.length, 0);
  const trusted = {sender:currentWindow.webContents,senderFrame:{url:'copilot://app/'}};
  const before = await handlers.get('settings:get')(trusted);
  const writesBefore = writes.length;
  assert.equal(await handlers.get('settings:rep-name')(trusted,'  Avery  '),'Avery');
  const after = await handlers.get('settings:get')(trusted);
  assert.equal(after.repName,'Avery');
  assert.deepEqual({...after,repName:before.repName},{...before},'Changing the name preserves all other settings');
  assert.equal(writes.length,writesBefore+1);
  assert.equal(JSON.parse(writes.at(-1).data).repName,'Avery');
  assert.match(writes.at(-1).file,/settings.json$/);
  assert.equal(deleted.length,0,'Name save never touches key storage');
  await assert.rejects(handlers.get('settings:rep-name')(trusted,' '),/Enter your name/);
  await assert.rejects(handlers.get('settings:rep-name')({senderFrame:{url:'https://untrusted.example'}},'Other'),/Untrusted/);
}
console.log(failing ? 'Page-load failure is reported and exits cleanly.' : 'Entry loads before ready; ready creates the app window.');
