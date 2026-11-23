// Investor voices: Inworld TTS 2 through Runware's audio inference API (one natural, distinct voice per agent).
// Returns an MP3 data URI, or null when no Runware key is configured (the browser then falls back to its own voices).
import { randomUUID } from "node:crypto";
import type { AgentId } from "../src/shared/types.js";

export const VOICES: Record<AgentId, string> = {
  point: "Priya",
  managing: "Edward",
  numbers: "Sarah",
  domain: "Marcus",
  skeptic: "Mark",
  associate: "Ethan",
  counsel: "Elizabeth",
};

export async function synthesize(agent: AgentId, text: string): Promise<string | null> {
  const key = process.env.RUNWARE_API_KEY;
  if (!key || !text.trim()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          taskType: "audioInference",
          taskUUID: randomUUID(),
          model: "inworld:tts@2",
          speech: { text: text.slice(0, 1900), voice: VOICES[agent] },
          outputType: "base64Data",
        },
      ]),
    });
    const json = (await res.json()) as { data?: { audioBase64Data?: string }[]; errors?: { message: string }[] };
    const b64 = json.data?.[0]?.audioBase64Data;
    if (!b64) {
      console.warn("[tts]", json.errors?.[0]?.message ?? res.status);
      return null;
    }
    return `data:audio/mpeg;base64,${b64}`;
  } catch (e) {
    console.warn("[tts]", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
