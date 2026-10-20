// Reserve rows when speech starts so delayed transcription cannot reorder a call.
export class Transcript {
  constructor() { this.rows = []; }
  reserve(id, speaker = 'unassigned', previousId) {
    let row = this.rows.find(row => row.id === id);
    if (row) return row;
    row = { id, speaker, speakerSource: speaker === 'unassigned' ? 'unknown' : 'native', text: '', final: false };
    const index = previousId ? this.rows.findIndex(row => row.id === previousId) : -1;
    if (index >= 0) this.rows.splice(index + 1, 0, row);
    else this.rows.push(row);
    return row;
  }
  delta(id, speaker, text) { const row = this.reserve(id, speaker); if (!row.final) row.text += text; return row; }
  complete(id, speaker, text) { const row = this.reserve(id, speaker); if (!row.interrupted) { row.text = text; row.final = true; } return row; }
  interrupt(id) { const row = this.reserve(id, 'buyer'); row.text = '[Buyer interrupted]'; row.final = true; row.interrupted = true; return row; }
  label(id, speaker) { const row = this.rows.find(row => row.id === id); if (row) { row.speaker = speaker; row.speakerSource = 'manual'; } }
  infer(roles) {
    for (const { id, speaker } of roles) {
      const row = this.rows.find(row => row.id === id);
      if (row && !['manual', 'native'].includes(row.speakerSource) && ['seller', 'buyer', 'unassigned'].includes(speaker)) { row.speaker = speaker; row.speakerSource = 'inferred'; }
    }
  }
  snapshot() { return this.rows.filter(row => row.final && row.text.trim()).slice(-60).map(({ id, speaker, speakerSource, text }) => ({ id, speaker, speakerSource, text })); }
}

export function friendlyError(error) {
  if (error.name === 'NotAllowedError') return 'Microphone access was denied. Allow Sales Copilot Fresh in System Settings → Privacy & Security → Microphone, then try again.';
  if (error.name === 'NotFoundError') return 'No microphone was found. Connect a microphone and try again.';
  if (error.name === 'NotReadableError') return 'The microphone is unavailable. Check your input device and try again.';
  return String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
}

// Session-only memory prevents dismissed or already-covered reminders returning.
export class ReminderMemory {
  constructor() { this.items = []; this.covered = new Set(); }
  update({ items = [], covered = [] }) {
    for (const id of covered) if (typeof id === 'string') this.covered.add(id);
    this.items = items.filter(item => !this.covered.has(item.id)).slice(0, 3);
  }
  dismiss(id) { this.covered.add(id); this.items = this.items.filter(item => item.id !== id); }
  snapshot() { return { items: this.items, covered: [...this.covered] }; }
}
