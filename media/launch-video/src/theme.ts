export const FPS = 30;
export const BPM = 128;
export const BAR = (4 * 60) / BPM; // 1.875 s
export const f = (bars: number) => Math.round(bars * BAR * FPS); // bars -> frames
// Scene boundaries in bars (aligned to the music)
export const CUTS = { prompt: 0, work: 2, check: 7, ship: 11, phone: 15, store: 19, outro: 21, end: 25 };
export const TOTAL = f(CUTS.end) + 45;
export const C = {
  bg: "#0b0a16",
  ink: "#f5f3ff",
  muted: "#a5a3c4",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  cyan: "#22d3ee",
  green: "#34d399",
  card: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.12)",
};
export const FONT = "Inter, 'Inter Display', system-ui, sans-serif";
export const MONO = "'JetBrains Mono', 'DejaVu Sans Mono', monospace";
