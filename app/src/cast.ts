import type { AgentId } from "./shared/types";

// Visual identity of each agent (names/roles mirror server/agents.ts).
export const CAST: Record<
  AgentId,
  { name: string; role: string; color: string; suit: string; skin: string; hair: string; glasses: boolean; voice: { pitch: number; rate: number; prefer: RegExp } }
> = {
  associate: { name: "Sam Lindqvist", role: "Associate", color: "#38bdf8", suit: "#1e3a5f", skin: "#f1c7a3", hair: "#d9b26f", glasses: true, voice: { pitch: 1.15, rate: 1.08, prefer: /male|daniel|alex|fred/i } },
  numbers: { name: "Maya Chen", role: "Numbers partner", color: "#f472b6", suit: "#3b1f33", skin: "#f3d2b3", hair: "#1c1917", glasses: false, voice: { pitch: 1.2, rate: 1.1, prefer: /female|samantha|victoria|karen|zira/i } },
  point: { name: "Priya Raman", role: "Point partner", color: "#34d399", suit: "#14532d", skin: "#b9805c", hair: "#111827", glasses: false, voice: { pitch: 1.05, rate: 1.0, prefer: /female|moira|tessa|veena|google uk english female/i } },
  managing: { name: "Harold Voss", role: "Managing partner", color: "#fbbf24", suit: "#1f2937", skin: "#e8c2a0", hair: "#d1d5db", glasses: true, voice: { pitch: 0.7, rate: 0.9, prefer: /male|david|george|google uk english male/i } },
  skeptic: { name: "Rex Calloway", role: "Devil's advocate", color: "#f87171", suit: "#450a0a", skin: "#d9a07b", hair: "#3f2a1e", glasses: false, voice: { pitch: 0.85, rate: 1.05, prefer: /male|mark|aaron|rishi/i } },
  domain: { name: "Dev Okafor", role: "Product & market partner", color: "#a78bfa", suit: "#2e1065", skin: "#7a4b30", hair: "#0f0f0f", glasses: true, voice: { pitch: 0.95, rate: 1.02, prefer: /male|daniel|guy|google us english/i } },
  counsel: { name: "Elena Brooks", role: "General counsel", color: "#e5e7eb", suit: "#111827", skin: "#f0cfb5", hair: "#7c2d12", glasses: true, voice: { pitch: 1.0, rate: 0.95, prefer: /female|serena|kate|susan/i } },
};

// Seat order around the far side of the table, left to right from the founder's view.
export const SEAT_ORDER: AgentId[] = ["associate", "numbers", "point", "managing", "skeptic", "domain", "counsel"];
