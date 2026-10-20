import { test, expect } from '@playwright/test';

async function setup(page, hasKey = true) {
  await page.addInitScript(({ hasKey }) => {
    let onCoach;
    window.testState = { requests: [], sent: [], tracks: [], stops: 0, connects: 0, failConnect: false, delayConnect: false, settings: { hasKey, saved: false, context: 'Salesforce for retail' } };
    const s = window.testState;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await getUserMedia(constraints); s.tracks.push(...stream.getTracks()); return stream; };
    window.copilot = {
      settings: async () => s.settings,
      saveSettings: async data => {
        if (data.key && !data.key.startsWith('sk-')) throw new Error('Enter a valid OpenAI API key.');
        s.settings = { hasKey: Boolean(data.key || s.settings.hasKey), saved: data.remember, context: data.context, repName: data.repName }; return s.settings;
      },
      forgetKey: async () => { s.settings.hasKey = false; },
      microphonePermission: async () => true,
      connect: async () => { s.connects++; if (s.delayConnect) await new Promise(resolve => { s.releaseConnect = resolve; }); if (s.failConnect) throw new Error('OpenAI rejected this API key.'); return 'v=0\r\n'; },
      stop: async () => { s.stops++; },
      cancelCoach: async () => {},
      coach: async payload => { s.requests.push(payload); },
      onCoach: cb => { onCoach = cb; }, pin: async v => v,
    };
    window.emitCoach = data => onCoach(data);
    window.RTCPeerConnection = class {
      connectionState = 'new';
      createDataChannel() { const channel = this.channel = { readyState: 'connecting', send: text => s.sent.push(JSON.parse(text)), close: () => { channel.readyState = 'closed'; channel.onclose?.(); } }; s.channel = channel; return channel; }
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
      async setLocalDescription() {}
      async setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); this.channel.readyState = 'open'; this.channel.onopen?.(); }
      close() { this.connectionState = 'closed'; }
    };
    window.emitVoice = event => s.channel.onmessage({ data: JSON.stringify(event) });
  }, { hasKey });
  await page.goto('/');
}
async function start(page, speakerphone = false) {
  if (speakerphone) await page.getByRole('button', { name: /Speakerphone Get help/ }).click();
  await page.locator('#start').click();
  await expect(page.locator('#start')).toContainText('End session');
  if (speakerphone) await expect.poll(() => page.evaluate(() => testState.requests.length)).toBeGreaterThan(0);
  else await expect(page.locator('#suggestion')).toContainText('Omri from Salesforce');
}
test('fresh interface and missing-key setup; no unexpected API or microphone use', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await setup(page, false);
  await expect(page.getByRole('heading', { name: 'Find your flow.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/simulation.png' });
  await page.locator('#start').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  expect(await page.evaluate(() => testState.connects)).toBe(0);
  await page.locator('#api-key').fill('test-key-never-real');
  await page.getByRole('button', { name: /Save settings/ }).click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('#key-status')).toHaveText('OpenAI · key added');
  expect(errors).toEqual([]);
});
test('simulation opens as buyer, coaching streams, delayed transcripts keep order, stop releases microphone', async ({ page }) => {
  await setup(page); await start(page);
  expect(await page.evaluate(() => testState.sent[0].type)).toBe('response.create');
  await page.evaluate(() => {
    emitVoice({ type: 'response.created', response: { id: 'hello' } });
    emitVoice({ type: 'response.done', response: { id: 'hello', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
    emitVoice({ type: 'output_audio_buffer.stopped', response_id: 'hello' });
  });
  await expect.poll(() => page.evaluate(() => testState.tracks[0].enabled)).toBe(true);
  await page.evaluate(() => {
    emitVoice({ type: 'input_audio_buffer.speech_started', item_id: 'seller-1' });
    emitVoice({ type: 'response.output_item.added', item: { type: 'message', id: 'buyer-1' } });
    emitVoice({ type: 'response.output_audio_transcript.done', item_id: 'buyer-1', transcript: 'We lose track of customer requests.' });
    emitVoice({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'seller-1', transcript: 'What is difficult for your team?' });
  });
  await expect(page.locator('.turn').first()).toContainText('What is difficult');
  await expect.poll(() => page.evaluate(() => testState.requests.length)).toBeGreaterThan(0);
  await page.evaluate(() => emitCoach({ id: testState.requests.at(-1).id, type: 'delta', text: 'Where do those requests tend to get lost?' }));
  await expect(page.locator('#suggestion')).toHaveText('Where do those requests tend to get lost?');
  await page.getByRole('button', { name: 'Mute microphone' }).click();
  expect(await page.evaluate(() => testState.tracks.every(t => !t.enabled))).toBe(true);
  await page.screenshot({ path: 'test-results/active-simulation.png' });
  await page.locator('#start').click();
  expect(await page.evaluate(() => testState.tracks.every(t => t.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => emitCoach({ id: testState.requests.at(-1).id, type: 'delta', text: 'STALE OUTPUT' }));
  await expect(page.locator('#suggestion')).not.toContainText('STALE OUTPUT');
});
test('speakerphone sends no voice response; both parties reach coaching; labels are correctable', async ({ page }) => {
  await setup(page); await start(page, true);
  expect(await page.evaluate(() => testState.sent.length)).toBe(0);
  await page.evaluate(() => {
    emitVoice({ type: 'input_audio_buffer.speech_started', item_id: 'one' });
    emitVoice({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'We already have a CRM.' });
    emitVoice({ type: 'input_audio_buffer.speech_started', item_id: 'two' });
    emitVoice({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'two', transcript: 'How is that working for you?' });
  });
  await expect(page.locator('.turn')).toHaveCount(2);
  await page.locator('.speaker-label').last().click();
  await expect(page.locator('.speaker-label').last()).toHaveText('You');
  await expect.poll(() => page.evaluate(() => testState.requests.at(-1).turns.at(-1)?.speaker)).toBe('seller');
  await page.screenshot({ path: 'test-results/speakerphone.png' });
});
test('switching mode cancels a pending connection and late completion cannot revive it', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { testState.delayConnect = true; });
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => testState.connects)).toBe(1);
  await page.locator('#speakerphone-tab').click();
  await page.evaluate(() => testState.releaseConnect());
  await expect(page.locator('#start')).toContainText('Start listening');
  expect(await page.evaluate(() => testState.tracks.every(t => t.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => testState.sent.length)).toBe(0);
});
test('connection failure is actionable and releases microphone', async ({ page }) => {
  await setup(page); await page.evaluate(() => { testState.failConnect = true; });
  await page.locator('#start').click();
  await expect(page.getByRole('alert').first()).toContainText('OpenAI rejected');
  await expect(page.locator('#start')).toContainText('Start simulation');
  expect(await page.evaluate(() => testState.tracks.every(t => t.readyState === 'ended'))).toBe(true);
});
test('new coaching invalidates an old stream before the next request; transcript text is never HTML', async ({ page }) => {
  await setup(page); await start(page, true);
  await page.evaluate(() => {
    const oldId = testState.requests.at(-1).id;
    emitVoice({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'x', transcript: '<img src=x onerror="alert(1)">' });
    emitCoach({ id: oldId, type: 'delta', text: 'STALE OUTPUT' });
  });
  await expect(page.locator('#suggestion')).not.toContainText('STALE OUTPUT');
  await expect(page.locator('.turn')).toContainText('<img');
  expect(await page.locator('#transcript img').count()).toBe(0);
});
