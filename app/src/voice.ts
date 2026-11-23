import type { AgentId, TranscriptLine } from "./shared/types";
import { CAST } from "./cast";

// Plays agent lines one at a time with a distinct browser voice per agent.
// Falls back to a reading-time delay when muted or when speech synthesis is unavailable.
type Listener = (line: TranscriptLine | null) => void;

class VoiceQueue {
  private queue: TranscriptLine[] = [];
  private playing = false;
  muted = false;
  private listeners = new Set<Listener>();
  private voiceFor = new Map<AgentId, SpeechSynthesisVoice | null>();

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  get pending() {
    return this.queue.length + (this.playing ? 1 : 0);
  }
  enqueue(line: TranscriptLine) {
    this.queue.push(line);
    if (!this.playing) void this.next();
  }
  // Skip the line being spoken now.
  skip() {
    this.skipCurrent?.();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
  // Drop everything still waiting (used when the meeting moves to a new phase).
  clearPending() {
    this.queue = [];
  }
  private skipCurrent: (() => void) | null = null;

  private pickVoice(a: AgentId) {
    if (this.voiceFor.has(a)) return this.voiceFor.get(a)!;
    const voices = (typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : []).filter((v) => v.lang.startsWith("en"));
    const used = new Set([...this.voiceFor.values()].filter(Boolean).map((v) => v!.name));
    const v =
      voices.find((x) => CAST[a].voice.prefer.test(x.name) && !used.has(x.name)) ??
      voices.find((x) => !used.has(x.name)) ??
      voices[0] ??
      null;
    if (voices.length) this.voiceFor.set(a, v);
    return v;
  }

  private async next() {
    const line = this.queue.shift();
    if (!line) {
      this.playing = false;
      this.listeners.forEach((l) => l(null));
      return;
    }
    this.playing = true;
    this.listeners.forEach((l) => l(line));
    await this.say(line);
    await new Promise((r) => setTimeout(r, 250));
    void this.next();
  }

  private say(line: TranscriptLine) {
    const readMs = Math.min(9000, 1200 + line.text.split(/\s+/).length * 330);
    if (this.muted || typeof speechSynthesis === "undefined" || line.speaker === "founder")
      return new Promise<void>((r) => {
        this.skipCurrent = () => r();
        setTimeout(r, line.speaker === "founder" ? 0 : readMs);
      });
    return new Promise<void>((resolve) => {
      this.skipCurrent = () => resolve();
      const u = new SpeechSynthesisUtterance(line.text);
      const a = line.speaker as AgentId;
      const v = this.pickVoice(a);
      if (v) u.voice = v;
      u.pitch = CAST[a].voice.pitch;
      u.rate = CAST[a].voice.rate;
      const done = () => resolve();
      u.onend = done;
      // No usable voice: keep the speech bubble up for reading time instead.
      u.onerror = () => setTimeout(done, readMs);
      setTimeout(done, readMs + 8000); // safety net if the browser never fires onend
      speechSynthesis.speak(u);
    });
  }
}

export const voice = new VoiceQueue();
