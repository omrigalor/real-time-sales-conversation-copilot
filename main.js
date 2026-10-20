import { CredentialStore } from './credential-store.js';
import { assessLifecycle } from './call-lifecycle-api.js';
import { createBuyerVoiceResolver } from './buyer-voice-api.js';
import { researchedTarget } from './app/researched-target.js';
import { updateResearchLibrary } from './app/account-seeds.js';
import { diarizeAudio } from './speaker-audio-api.js';
import { assessProductFocus } from './product-focus-api.js';
import { inheritProfileVoice, normalizeLibrary, saveToLibrary } from './app/account-library.js';
import { scopedSalesContext, normalizeContextNotes } from './app/call-context.js';
import { researchAccount } from './research-api.js';
import { handoffCall } from './handoff-api.js';
import { normalizeAccount, publicURL } from './app/account-context.js';
import { app, BrowserWindow, ipcMain, protocol, net, session, safeStorage, systemPreferences, Menu, dialog, shell } from 'electron';
import { installMediaPermissions } from './media-permissions.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { connectOpenAI, streamCoach, MODELS } from './api.js';
import { observeTurn, reviewCall } from './training-api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const origin = 'copilot://app';
protocol.registerSchemesAsPrivileged([{ scheme: 'copilot', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Sales Copilot Fresh');
if (process.env.COPILOT_TEST_DATA) app.setPath('userData', process.env.COPILOT_TEST_DATA);
let window, key = process.env.OPENAI_API_KEY || '';
let legacyContext = '', contextNotes = {}; // Old global text is retained for reference, never injected into calls.
const resolveBuyerVoice = createBuyerVoiceResolver();
let accountLibrary = [], researchedDefaultVersion = 0;
let repName = 'Omri', accountBrief = null, researchProvider = 'openai';
let connection, coaching;
const trainingRequests = new Map();
const keyPath = () => path.join(app.getPath('userData'), 'openai.enc');
const credentials = new CredentialStore({filename:keyPath(),storage:safeStorage,initialKey:key});
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const isTrusted = event => event.sender === window?.webContents && event.senderFrame?.url.startsWith(origin + '/');
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Untrusted window.');
    return fn(...args);
  });
}
function stopRequests() { for (const controller of trainingRequests.values()) controller.abort(); trainingRequests.clear(); connection?.abort(); coaching?.abort(); connection = coaching = undefined; }

function startupFailed(error) {
  dialog.showErrorBox('Sales Copilot could not open', String(error.message || error));
  app.quit();
}

// Electron finishes evaluating this module before it emits ready. Awaiting
// whenReady at module scope would make those two steps wait on each other.
app.whenReady().then(async () => {
  await mkdir(app.getPath('userData'), { recursive: true });
  try { const settings = JSON.parse(await readFile(settingsPath(), 'utf8')); legacyContext = settings.legacyContext || settings.context || ''; contextNotes = normalizeContextNotes(settings.contextNotes); repName = settings.repName || repName; accountBrief = normalizeAccount(settings.accountBrief); accountLibrary = normalizeLibrary(settings.accountLibrary); researchedDefaultVersion = settings.researchedDefaultVersion || 0; researchProvider = settings.researchProvider === 'off' ? 'off' : 'openai'; } catch {}
  if (!researchedDefaultVersion) {
    if(accountBrief && !accountBrief.demo) accountLibrary=saveToLibrary(accountLibrary,accountBrief);
    accountBrief=researchedTarget(); accountLibrary=saveToLibrary(accountLibrary,accountBrief); researchedDefaultVersion=1;
    await writeFile(settingsPath(), JSON.stringify({legacyContext,contextNotes,repName,accountBrief,accountLibrary,researchedDefaultVersion,researchProvider}),{mode:0o600});
  }
  if(!accountLibrary.length) accountLibrary=[researchedTarget()];
  const nextResearch=updateResearchLibrary({accountBrief,accountLibrary,researchedDefaultVersion});
  if(JSON.stringify(nextResearch)!==JSON.stringify({accountBrief,accountLibrary,researchedDefaultVersion})){
    ({accountBrief,accountLibrary,researchedDefaultVersion}=nextResearch);
    await writeFile(settingsPath(),JSON.stringify({legacyContext,contextNotes,repName,accountBrief,accountLibrary,researchedDefaultVersion,researchProvider}),{mode:0o600});
  }
  const voiceProfiles=[researchedTarget()];
  accountBrief=inheritProfileVoice(accountBrief,voiceProfiles);
  accountLibrary=accountLibrary.map(account=>inheritProfileVoice(account,voiceProfiles));
  await credentials.load(); key = credentials.key;
  protocol.handle('copilot', request => {
    const url = new URL(request.url);
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (url.host !== 'app' || !['index.html', 'styles.css', 'renderer.js', 'session.js', 'state.js', 'scenarios.js', 'observe.js', 'account-context.js', 'brief.js', 'call-context.js', 'account-library.js', 'researched-target.js', 'live-speakers.js', 'speaker-capture-worklet.js', 'mac-call-audio.js'].includes(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(root, 'app', name)).href);
  });
  installMediaPermissions(session.defaultSession,()=>window,origin);
  handle('settings:get', () => ({ ...credentials.status(), legacyContext, contextNotes, repName, accountBrief, accountLibrary, researchedDefaultVersion, researchProvider, models: MODELS }));
  handle('settings:rep-name', async value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\r\n]/.test(value)) throw new Error('Enter your name using up to 80 characters.');
    const name = value.trim();
    await writeFile(settingsPath(), JSON.stringify({ legacyContext, contextNotes, repName: name, accountBrief, accountLibrary, researchedDefaultVersion, researchProvider }), { mode: 0o600 });
    repName = name;
    return repName;
  });
  handle('settings:save', async data => {
    if (!data || typeof data.context !== 'string' || data.context.length > 3000 || typeof data.contextScope !== 'string' || !data.contextScope.startsWith('[') || data.contextScope.length > 1600) throw new Error('Keep notes under 3,000 characters and choose a call setup.');
    if (data.repName !== undefined && (typeof data.repName !== 'string' || !data.repName.trim() || data.repName.length > 80)) throw new Error('Enter your name using up to 80 characters.');
    const newKey = String(data.key || '').trim();
    if (newKey && (!newKey.startsWith('sk-') || newKey.length < 20 || /\s/.test(newKey))) throw new Error('Enter a valid OpenAI API key beginning with sk-.');
    await credentials.save({newKey,remember:data.remember !== false}); key = credentials.key;
    contextNotes = normalizeContextNotes({...contextNotes, [data.contextScope]: data.context}); repName = data.repName?.trim() || repName;
    if (data.researchProvider !== undefined) researchProvider = data.researchProvider === 'off' ? 'off' : 'openai';
    await writeFile(settingsPath(), JSON.stringify({ legacyContext, contextNotes, repName, accountBrief, accountLibrary, researchedDefaultVersion, researchProvider }), { mode: 0o600 });
    return { ...credentials.status(), legacyContext, contextNotes, repName, accountBrief, accountLibrary, researchedDefaultVersion, researchProvider, models: MODELS };
  });
  handle('account:save', async value => {
    accountBrief = normalizeAccount(value);
    accountLibrary=saveToLibrary(accountLibrary,accountBrief);
    await writeFile(settingsPath(), JSON.stringify({legacyContext,contextNotes,repName,accountBrief,accountLibrary,researchedDefaultVersion,researchProvider}), {mode:0o600});
    return accountBrief;
  });
  handle('source:open', async value => { const url=publicURL(value); if (!url) throw new Error('Only public HTTPS sources can be opened.'); await shell.openExternal(url); });
  handle('settings:retry-key', async () => { const state=await credentials.load(); key=credentials.key; return state; });
  handle('settings:forget', async () => { stopRequests(); await credentials.forget(); key=credentials.key; return true; });
  handle('audio:permission', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });
  handle('session:connect', async payload => {
    connection?.abort();
    const controller = new AbortController(); connection = controller;
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const buyerVoice=await resolveBuyerVoice({key,payload,signal:controller.signal});
      controller.signal.throwIfAborted();
      return await connectOpenAI({ ...payload, buyerVoice, connectionDetails:true, context: scopedSalesContext(payload, contextNotes), key, signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted) throw new Error('Connection stopped or timed out. Try Start again.'); throw error; }
    finally { clearTimeout(timer); if (connection === controller) connection = undefined; }
  });
  handle('session:stop', () => { stopRequests(); });
  handle('audio:diarize',async payload=>{
    trainingRequests.get('diarize')?.abort();
    const controller=new AbortController();trainingRequests.set('diarize',controller);
    const timer=setTimeout(()=>controller.abort(),20000);
    try{return await diarizeAudio({key,payload,signal:controller.signal});}
    finally{clearTimeout(timer);if(trainingRequests.get('diarize')===controller)trainingRequests.delete('diarize');}
  });
  handle('coach:cancel', () => { coaching?.abort(); coaching = undefined; });
  handle('coach:start', async payload => {
    if (!payload || typeof payload.id !== 'string' || payload.id.length > 100) throw new Error('Invalid suggestion request.');
    coaching?.abort();
    const controller = new AbortController(); coaching = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    const send = event => { if (!window?.isDestroyed() && coaching === controller) window.webContents.send('coach:event', { id: payload.id, ...event }); };
    try {
      await streamCoach({ key, payload: { ...payload, context: scopedSalesContext(payload, contextNotes), repName }, signal: controller.signal, onDelta: text => send({ type: 'delta', text }), onRoles: roles => send({ type: 'roles', roles }), onHold: (reason, focus) => send({ type: 'hold', reason, focus }), onProgress: progress => send({ type: 'progress', progress }), onReminders: reminders => send({ type: 'reminders', reminders }), onOpportunity: opportunity => send({ type: 'opportunity', opportunity }), onMemory: memory => send({ type: 'memory', memory }), onObjective: objective => send({ type: 'objective', objective }), onSupport: support => send({ type: 'support', support }) });
      send({ type: 'done' });
    } catch (error) {
      if (coaching === controller) send({ type: 'error', message: controller.signal.aborted ? 'Suggestion timed out. Try Refresh.' : error.message });
    } finally { clearTimeout(timer); if (coaching === controller) coaching = undefined; }
  });
  for (const [name, operation] of [['lifecycle', assessLifecycle], ['product-focus', assessProductFocus], ['observe', observeTurn], ['review', reviewCall], ['research', researchAccount], ['handoff', handoffCall]]) handle('training:' + name, async payload => {
    if(name==='product-focus' && payload.mode==='simulation')void resolveBuyerVoice({key,payload}).catch(()=>{});
    trainingRequests.get(name)?.abort();
    const controller = new AbortController(); trainingRequests.set(name, controller);
    const timer = setTimeout(() => controller.abort(), name === 'research' ? 120000 : name === 'lifecycle' ? 6000 : 45000);
    try { return await operation({ key, payload, context: name === 'research' ? '' : scopedSalesContext(payload, contextNotes), repName, provider:researchProvider, signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted) throw new Error('Practice request stopped or timed out. Try again.'); throw error; }
    finally { clearTimeout(timer); if (trainingRequests.get(name) === controller) trainingRequests.delete(name); }
  });
  handle('window:pin', value => { window.setAlwaysOnTop(Boolean(value), 'floating'); return window.isAlwaysOnTop(); });
  function createWindow() {
    window = new BrowserWindow({
      width: 1200, height: 820, minWidth: 800, minHeight: 620, title: 'Sales Copilot Fresh',
      backgroundColor: '#f8f9fb', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 22 },
      webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', stopRequests);
    window.on('closed', () => { stopRequests(); window = undefined; });
    return window.loadURL(origin + '/');
  }
  let evaluationRunning = false;
  async function evaluateBehavior(comparison = 'pacing') {
    if (evaluationRunning) return;
    if (!key) { dialog.showErrorBox('Add an OpenAI key first', 'Add your key in Settings, then run the development evaluation again.'); return; }
    evaluationRunning = true;
    const directory = path.join(app.getPath('desktop'), 'Sales Copilot Regression Results', new Date().toISOString().replace(/[:.]/g, '-'));
    try {
      const { runSuite } = await import('./evaluation/runner.js');
      const variants = comparison==='openings'?['before-opening','current']:comparison==='buyer-realism'?['level-1','level-3','level-5']:comparison==='realism'?['current']:['cross-mode','intelligence'].includes(comparison) ? ['before-training','current'] : comparison === 'batch-ablation' ? ['current-without-batch1', 'current'] : comparison === 'pre-batch' ? ['baseline', 'current'] : ['before-pacing', 'current'];
      window?.setProgressBar(0);
      const report = await runSuite({ key, directory, variants, crossMode: comparison === 'cross-mode', intelligence: comparison === 'intelligence', realism:comparison==='realism', buyerRealism:comparison==='buyer-realism', openingReview:comparison==='openings', onProgress: progress => window?.setProgressBar(progress.case / progress.total) });
      await shell.openPath(path.join(directory, 'report.html'));
      if (report.status.includes('errors')) dialog.showErrorBox('Some evaluation requests failed', 'The report preserves successful outputs and lists each request error. No answers were invented.');
    } catch (error) { dialog.showErrorBox('Behavior evaluation failed', error.message); }
    finally { evaluationRunning = false; window?.setProgressBar(-1); }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'windowMenu' },
    { label: 'Development', submenu: [
      {label:'Compare 10 opening cases: 1.0.19 / current…',click:()=>evaluateBehavior('openings')},
      {label:'Compare buyer realism: levels 1 / 3 / 5…',click:()=>evaluateBehavior('buyer-realism')},
      {label:'Run 57-case realism / shared intelligence review…',click:()=>evaluateBehavior('realism')},
      { label: 'Run 45-case shared intelligence / opener review…', click: () => evaluateBehavior('intelligence') },
      { label: 'Run 33-case cross-mode / live-call review…', click: () => evaluateBehavior('cross-mode') },
      { label: 'Run 21-case pacing / disclosure comparison…', click: () => evaluateBehavior() },
      { label: 'Compare saved pre-Batch-1 / current…', click: () => evaluateBehavior('pre-batch') },
      { label: 'Compare current with / without Batch 1…', click: () => evaluateBehavior('batch-ablation') },
    ] },
  ]));
  await createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow().catch(startupFailed); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopRequests);
}).catch(startupFailed);
