// Optional sponsor integrations. Each turns on only when its key is set; without it the meeting runs as before.
import { randomUUID } from "node:crypto";

/* ---------- Glasser: the associate's pre-meeting diligence (recent news in the founder's market) ---------- */

export interface NewsItem {
  title: string;
  url: string;
  source: string | null;
  snippet: string | null;
  date_text: string | null;
}

export async function glasserNews(query: string): Promise<NewsItem[]> {
  const key = process.env.GLASSER_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.glasser.ai/v1/solutions/gtm/web_research", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ action: "news", query: query.slice(0, 480) }),
  });
  if (!res.ok) throw new Error(`Glasser ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { output?: { items?: NewsItem[] } | null };
  return (json.output?.items ?? []).slice(0, 5);
}

/* ---------- BAND: a live partner-channel room where every whisper, fact-check and vote is posted ---------- */

const BAND = "https://api.band.ai/api/v1/agent";

async function band<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BAND}${path}`, {
    ...init,
    headers: { "X-API-Key": process.env.BAND_API_KEY ?? "", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`BAND ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type Peer = { id: string; handle: string; name: string };

export class BandChannel {
  private chain: Promise<unknown> = Promise.resolve();
  private constructor(
    readonly chatId: string,
    private readonly to: Peer,
  ) {}

  // Opens a room owned by the firm's BAND agent and invites the agent's human owner to watch it.
  static async open(): Promise<BandChannel | null> {
    if (!process.env.BAND_API_KEY) return null;
    const peers = (await band<{ data: Peer[] }>("/peers?page_size=50")).data;
    const human = peers.find((p) => !p.handle.includes("/")) ?? peers[0];
    if (!human) throw new Error("BAND: no peer to invite (the agent's owner should appear as a peer)");
    const chat = (await band<{ data: { id: string } }>("/chats", { method: "POST", body: JSON.stringify({ chat: {} }) })).data;
    await band(`/chats/${chat.id}/participants`, {
      method: "POST",
      body: JSON.stringify({ participant: { participant_id: human.id, role: "member" } }),
    });
    return new BandChannel(chat.id, human);
  }

  // Messages are posted in order, one at a time; a failure never interrupts the meeting.
  post(text: string) {
    this.chain = this.chain
      .then(() =>
        band(`/chats/${this.chatId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            message: { content: `@${this.to.handle} ${text}`, mentions: [{ id: this.to.id, handle: this.to.handle, name: this.to.name }] },
          }),
        }),
      )
      .catch((e) => console.warn("[band]", (e as Error).message));
  }
}
