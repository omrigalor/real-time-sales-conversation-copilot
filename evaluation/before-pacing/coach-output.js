import { readReminders } from './reminders.js';
import { readOpportunity } from './opportunity.js';
import { speakerphoneDecision } from './speakerphone-policy.js';
import { readProgress } from './progress.js';
import { readConversationMemory } from './conversation-memory.js';

// Small role header, streamed rep sentence, then private insights. Never stream JSON into the card.
export class CoachOutput {
  constructor({ mode, turns, onDelta, onRoles = () => {}, onHold = () => {}, onProgress = () => {}, onReminders = () => {}, onOpportunity = () => {}, onMemory = () => {}, opportunityMemory = {}, conversationMemory = {}, previousRecommendation = null }) {
    Object.assign(this, { mode, onDelta, onRoles, onHold, onProgress, onReminders, onOpportunity, onMemory, opportunityMemory, conversationMemory, previousRecommendation });
    this.turns = turns.slice(-60); this.roles = []; this.stage = 'header'; this.pending = ''; this.text = ''; this.held = false;
  }
  insights(value) {
    const progress = readProgress(value.progress); if (progress) this.onProgress(progress);
    const reminders = readReminders(value.reminders); if (reminders) this.onReminders(reminders);
    const opportunity = readOpportunity(value.opportunity, this.turns, this.roles, this.opportunityMemory); if (opportunity) this.onOpportunity(opportunity);
    const memory = readConversationMemory(value.memory, this.turns, this.roles, this.conversationMemory); if (memory) this.onMemory(memory);
  }
  header(value) {
    if (!Array.isArray(value?.roles)) throw new Error('Speaker analysis was incomplete. Try Refresh.');
    const seen = new Set();
    for (const entry of value.roles.slice(0, 8)) {
      if (!Array.isArray(entry)) continue;
      const [index, speaker, confidence] = entry;
      const turn = this.turns[index];
      if (!Number.isInteger(index) || index < Math.max(0, this.turns.length - 8) || !turn?.id || seen.has(index)) continue;
      if (['manual', 'native'].includes(turn.speakerSource)) continue;
      if (!['seller', 'buyer', 'unassigned'].includes(speaker) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
      if (speaker !== 'unassigned' && confidence < 0.9) continue;
      seen.add(index); this.roles.push({ id: turn.id, speaker });
    }
    if (this.mode === 'speakerphone') this.onRoles(this.roles);
    this.insights(value);
    let decision = this.mode === 'speakerphone' ? speakerphoneDecision(this.turns, this.roles, value)
      : (value.for === 'seller' && ['suggest', 'listen', 'keep'].includes(value.action) && this.turns.at(-1)?.speaker !== 'seller' ? value.action : 'wait');
    if (decision === 'keep') {
      const previous = this.previousRecommendation;
      const anchor = this.turns.findIndex(turn => turn.id === previous?.turnId);
      // Reuse is only safe over more buyer context, never across a rep turn or unknown ownership.
      const buyerOnly = anchor >= 0 && this.turns.slice(anchor + 1).every(turn =>
        (['manual', 'native'].includes(turn.speakerSource) ? turn.speaker : this.roles.find(role => role.id === turn.id)?.speaker) === 'buyer');
      if (!previous || !['suggest', 'listen', 'wait'].includes(previous.action) || !buyerOnly || (previous.action === 'suggest' && !previous.text?.trim())) decision = 'wait';
    }
    if (decision !== 'suggest') {
      this.held = true;
      const focus = value.for === 'seller' && ['listen', 'wait'].includes(decision) && typeof value.listen_for === 'string' ? value.listen_for.trim().slice(0, 160) : '';
      this.onHold(decision, focus);
    }
  }
  append(delta) {
    if (this.stage === 'header') {
      this.pending += delta;
      const newline = this.pending.indexOf('\n');
      if (newline < 0) {
        if (this.pending.length > 14000) throw new Error('Speaker analysis did not finish. Try Refresh.');
        return;
      }
      let header;
      try { header = JSON.parse(this.pending.slice(0, newline)); }
      catch { throw new Error('Speaker analysis could not be read. Try Refresh.'); }
      this.header(header);
      delta = this.pending.slice(newline + 1); this.pending = ''; this.stage = 'sentence';
    }
    if (this.stage === 'sentence') {
      const newline = delta.indexOf('\n');
      const text = newline < 0 ? delta : delta.slice(0, newline);
      if (!this.held && text) { this.text += text; this.onDelta(this.text); }
      if (newline < 0) return;
      delta = delta.slice(newline + 1); this.stage = 'insights';
    }
    this.pending += delta;
    if (this.pending.length > 18000) throw new Error('Call insights were too long. Try Refresh.');
  }
  finish() {
    if (this.stage === 'header' && this.pending) this.append('\n');
    if (this.stage === 'insights' && this.pending.trim()) {
      let insights;
      try { insights = JSON.parse(this.pending); } catch { throw new Error('Call insights did not finish. Try Refresh.'); }
      if (!insights || typeof insights !== 'object') throw new Error('Call insights could not be read. Try Refresh.');
      this.insights(insights);
    }
  }
}
