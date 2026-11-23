import type { AgentId, TranscriptLine } from "./shared/types";

// Plays agent lines one at a time. Normal path: the server sends an MP3 per line (Inworld voices via Runware).
// Fallback without a Runware key: the browser's own voices, restricted to natural-sounding ones.
type Listener = (line: TranscriptLine | null) => void;
type Item = { line?: TranscriptLine; audio?: string; marker?: () => void };

// A valid 0.1 s silent WAV, built in code, used to unlock audio inside a click.
function silentWav() {
  const rate = 8000, n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let bin = "";
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

const PLAYBACK_RATE = 0.95; // a touch slower than the generated speech
const FALLBACK_RATE = 0.92;

// System voices that sound human. Novelty voices (Albert, Bad News, Zarvox, Whisper…) are never used.
const NATURAL = /(premium|enhanced|natural|samantha|daniel|karen|moira|tessa|serena|kate|oliver|alex|ava|allison|susan|tom|google (us|uk) english|microsoft (aria|guy|jenny|davis|libby|ryan|sonia))/i;
const NOVELTY = /(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley|fred|ralph|kathy|princess|bruce|agnes|vicki|victoria)/i;
const PREFER_FEMALE: Record<AgentId, boolean> = { point: true, numbers: true, counsel: true, managing: false, skeptic: false, domain: false, associate: false };

class VoiceQueue {
  private queue: Item[] = [];
  private playing = false;
  muted = false;
  private listeners = new Set<Listener>();
  private voiceFor = new Map<AgentId, SpeechSynthesisVoice | null>();
  private skipCurrent: (() => void) | null = null;
  private current: HTMLAudioElement | null = null;
  // One player reused for every line: Safari only lets an element play sound once a click has unlocked it.
  private player: HTMLAudioElement | null = typeof Audio !== "undefined" ? new Audio() : null;

  // Call from a click handler (e.g. "Walk into the room") so later lines may play with sound.
  unlock() {
    const p = this.player;
    if (!p) return;
    p.src = silentWav();
    p.play().catch(() => {});
    if (typeof speechSynthesis !== "undefined") speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  get pending() {
    return this.queue.length + (this.playing ? 1 : 0);
  }
  enqueue(line: TranscriptLine, audio?: string) {
    this.queue.push({ line, audio });
    if (!this.playing) void this.next();
  }
  // Runs fn once every line queued before it has been spoken (e.g. move the room to the next phase).
  enqueueMarker(fn: () => void) {
    this.queue.push({ marker: fn });
    if (!this.playing) void this.next();
  }
  // Skip the line being spoken now.
  skip() {
    this.current?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.skipCurrent?.();
  }
  // Drop everything still waiting (used when the meeting moves to a new phase).
  clearPending() {
    this.queue = [];
  }

  private pickVoice(a: AgentId) {
    if (this.voiceFor.has(a)) return this.voiceFor.get(a)!;
    const all = (typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : []).filter(
      (v) => v.lang.startsWith("en") && !NOVELTY.test(v.name),
    );
    const natural = all.filter((v) => NATURAL.test(v.name));
    const pool = natural.length ? natural : all;
    const used = new Set([...this.voiceFor.values()].filter(Boolean).map((v) => v!.name));
    const female = /samantha|karen|moira|tessa|serena|kate|ava|allison|susan|aria|jenny|libby|sonia|female/i;
    const fits = (v: SpeechSynthesisVoice) => female.test(v.name) === PREFER_FEMALE[a];
    const v = pool.find((x) => fits(x) && !used.has(x.name)) ?? pool.find((x) => !used.has(x.name)) ?? pool[0] ?? null;
    if (all.length) this.voiceFor.set(a, v);
    return v;
  }

  private async next() {
    const item = this.queue.shift();
    if (!item) {
      this.playing = false;
      this.listeners.forEach((l) => l(null));
      return;
    }
    this.playing = true;
    if (item.marker) {
      item.marker();
      return void this.next();
    }
    this.listeners.forEach((l) => l(item.line!));
    await this.say(item as { line: TranscriptLine; audio?: string });
    await new Promise((r) => setTimeout(r, 300));
    void this.next();
  }

  private say({ line, audio }: { line: TranscriptLine; audio?: string }) {
    const readMs = Math.min(10000, 1400 + line.text.split(/\s+/).length * 360);
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          this.current = null;
          resolve();
        }
      };
      this.skipCurrent = finish;
      if (line.speaker === "founder") return finish();
      if (this.muted) return void setTimeout(finish, readMs);
      if (audio) {
        const el = this.player ?? new Audio();
        el.src = audio;
        el.playbackRate = PLAYBACK_RATE;
        el.preservesPitch = true;
        el.onended = finish;
        el.onerror = () => setTimeout(finish, readMs);
        this.current = el;
        el.play().catch(() => setTimeout(finish, readMs)); // autoplay blocked: keep the caption up for reading time
        setTimeout(finish, 30000); // safety net
        return;
      }
      if (typeof speechSynthesis === "undefined") return void setTimeout(finish, readMs);
      const u = new SpeechSynthesisUtterance(line.text);
      const v = this.pickVoice(line.speaker as AgentId);
      if (v) u.voice = v;
      u.rate = FALLBACK_RATE;
      u.onend = finish;
      u.onerror = () => setTimeout(finish, readMs);
      setTimeout(finish, readMs + 8000);
      speechSynthesis.speak(u);
    });
  }
}

export const voice = new VoiceQueue();
