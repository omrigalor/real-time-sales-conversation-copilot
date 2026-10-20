import { coldOpeningLine } from './seller-opening.js';
import { readSupport } from './product-knowledge.js';
import { readReminders } from './reminders.js';
import { readOpportunity } from './opportunity.js';
import { speakerphoneDecision } from './speakerphone-policy.js';
import { readObjective } from './objective.js';
import { readProgress } from './progress.js';
import { readConversationMemory } from './conversation-memory.js';

// Presentation cleanup only: retain spoken introductions and ordinary sentence colons.
// Buffer a possible leading speaker tag while streaming so fragments never flash in the card.
export function spokenLine(value, repName = '', partial = false) {
  let text = String(value || '').trimStart();
  const openingQuote = /^["“]/.test(text) ? text[0] : '';
  if (openingQuote) text = text.slice(1);
  if (partial && /^[*\s]*$/.test(text)) return '';
  const name = String(repName || '').trim();
  const labels = [...new Set([name, name.split(/\s+/)[0], 'Salesforce rep', 'Salesforce representative', 'Seller', 'Rep', 'You'].filter(Boolean))];
  const escape = label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = new RegExp(`^(?:\\*\\*)?(?:${labels.map(escape).join('|')})(?:\\*\\*)?\\s*:\\s*(?:\\*\\*)?`, 'i');
  const candidate = text.replace(/^\*\*/, '').replace(/\*+$/, '').trimEnd().toLocaleLowerCase();
  if (partial && candidate && labels.some(label => `${label.toLocaleLowerCase()}:`.startsWith(candidate))) return '';
  const tagged = prefix.test(text);
  text = text.replace(prefix, '').trimStart();
  const quote = /^["“]/.test(text) ? text[0] : openingQuote;
  if (/^["“]/.test(text)) text = text.slice(1);
  if (quote) {
    const closing = quote === '“' ? '”' : '"';
    if (text.trimEnd().endsWith(closing)) text = text.trimEnd().slice(0, -1);
    else if (!partial && !tagged) text = quote + text;
  }
  return text;
}

// Small role header, streamed rep sentence, then private insights. Never stream JSON into the card.
export class CoachOutput {
  constructor({ mode, turns, opening = false, repName = '', onDelta, onRoles = () => {}, onHold = () => {}, onProgress = () => {}, onReminders = () => {}, onOpportunity = () => {}, onMemory = () => {}, onObjective = () => {}, onSupport = () => {}, opportunityMemory = {}, conversationMemory = {}, previousRecommendation = null }) {
    Object.assign(this, { mode, onDelta, onRoles, onHold, onProgress, onReminders, onOpportunity, onMemory, onObjective, onSupport, opportunityMemory, conversationMemory, previousRecommendation });
    this.turns = turns.slice(-60); this.roles = []; this.stage = 'header'; this.pending = ''; this.text = ''; this.held = false;
    this.opening=opening;this.fixedOpening=false;this.repName = repName; this.rawSentence = '';
  }
  insights(value) {
    const support = readSupport(value.support, this.turns); if (support) this.onSupport(support);
    const objective = readObjective(value.objective, this.turns, this.roles); if (objective) this.onObjective(objective);
    const progress = readProgress(value.progress); if (progress) this.onProgress(progress);
    const reminders = readReminders(value.reminders); if (reminders) this.onReminders(reminders);
    const opportunity = readOpportunity(value.opportunity, this.turns, this.roles, this.opportunityMemory); if (opportunity) this.onOpportunity(opportunity);
    const memory = readConversationMemory(value.memory, this.turns, this.roles, this.conversationMemory); if (memory) this.onMemory(memory);
  }
  header(value) {
    if (!Array.isArray(value?.roles)) throw new Error('Speaker analysis was incomplete. Try Refresh.');
    if(this.opening && !['cold_opening','natural'].includes(value.delivery))throw new Error('Opening context was missing. Try Refresh.');
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
      : (value.for === 'seller' && ['suggest', 'hold', 'listen', 'keep'].includes(value.action) && this.turns.at(-1)?.speaker !== 'seller' ? value.action : 'wait');
    if (decision === 'keep') {
      const previous = this.previousRecommendation;
      const anchor = this.turns.findIndex(turn => turn.id === previous?.turnId);
      // Reuse is only safe over more buyer context, never across a rep turn or unknown ownership.
      const buyerOnly = anchor >= 0 && this.turns.slice(anchor + 1).every(turn =>
        (['manual', 'native'].includes(turn.speakerSource) ? turn.speaker : this.roles.find(role => role.id === turn.id)?.speaker) === 'buyer');
      if (!previous || !['suggest', 'hold', 'listen', 'wait'].includes(previous.action) || !buyerOnly || (previous.action === 'suggest' && !previous.text?.trim())) decision = 'wait';
    }
    this.fixedOpening = decision==='suggest' && value.delivery==='cold_opening';
    if(this.fixedOpening){this.text=coldOpeningLine(this.repName);this.onDelta(this.text);}
    if (decision !== 'suggest') {
      this.held = true;
      const focus = value.for === 'seller' && ['hold', 'listen', 'wait'].includes(decision) && typeof value.listen_for === 'string' ? value.listen_for.trim().slice(0, 160) : '';
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
      if (!this.held && !this.fixedOpening && text) {
        this.rawSentence += text;
        const clean = spokenLine(this.rawSentence, this.repName, newline < 0);
        if (clean && clean !== this.text) { this.text = clean; this.onDelta(this.text); }
      }
      if (newline < 0) return;
      delta = delta.slice(newline + 1); this.stage = 'insights';
    }
    this.pending += delta;
    if (this.pending.length > 18000) throw new Error('Call insights were too long. Try Refresh.');
  }
  finish() {
    if (this.stage === 'header' && this.pending) this.append('\n');
    if (!this.held && !this.fixedOpening && this.rawSentence) {
      const clean = spokenLine(this.rawSentence, this.repName);
      if (clean !== this.text) { this.text = clean; this.onDelta(this.text); }
    }
    if (this.stage === 'insights' && this.pending.trim()) {
      let insights;
      try { insights = JSON.parse(this.pending); } catch { throw new Error('Call insights did not finish. Try Refresh.'); }
      if (!insights || typeof insights !== 'object') throw new Error('Call insights could not be read. Try Refresh.');
      this.insights(insights);
    }
  }
}
