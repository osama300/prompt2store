import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, MONO } from "./theme";

export const useVertical = () => {
  const { width, height } = useVideoConfig();
  return height > width;
};

/** Animated dark background with drifting glows (same palette as the hero image). */
export const Backdrop: React.FC<{ hue?: number }> = ({ hue = 0 }) => {
  const frame = useCurrentFrame();
  const x = 70 + Math.sin(frame / 90) * 10;
  const y = 20 + Math.cos(frame / 110) * 8;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at ${x}% ${y}%, hsla(${250 + hue},70%,45%,0.55), transparent 60%),
          radial-gradient(900px 600px at ${100 - x}% ${100 - y}%, hsla(${195 + hue},80%,35%,0.40), transparent 60%), ${C.bg}`,
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** Pop-in helper: spring scale + fade starting at `delay` frames. */
export const usePop = (delay = 0, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping, mass: 0.7 } });
  return { opacity: interpolate(frame - delay, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `scale(${0.85 + 0.15 * s}) translateY(${(1 - s) * 30}px)` };
};

export const Title: React.FC<{ kicker: string; title: React.ReactNode; delay?: number; align?: "left" | "center" }> = ({ kicker, title, delay = 0, align = "left" }) => {
  const pop = usePop(delay);
  const v = useVertical();
  return (
    <div style={{ ...pop, textAlign: align, fontFamily: FONT }}>
      <div style={{ color: C.cyan, fontWeight: 700, letterSpacing: 4, fontSize: v ? 30 : 26, textTransform: "uppercase" }}>{kicker}</div>
      <div style={{ color: C.ink, fontWeight: 800, fontSize: v ? 84 : 72, lineHeight: 1.05, letterSpacing: -2, marginTop: 10 }}>{title}</div>
    </div>
  );
};

export const Grad: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ background: `linear-gradient(90deg, #a5b4fc, ${C.cyan})`, WebkitBackgroundClip: "text", color: "transparent" }}>{children}</span>
);

/** macOS-style browser window around a UI screenshot. */
export const Browser: React.FC<{ src: string; width: number; url?: string; style?: React.CSSProperties; crop?: { left: number; top: number; zoom: number; aspect?: number } }> = ({ src, width, url = "localhost:4477", style, crop }) => (
  <div style={{ width, borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 40px 120px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)", ...style }}>
    <div style={{ height: 44, background: "#f1f1f4", display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
      ))}
      <div style={{ marginLeft: 18, flex: 1, height: 26, borderRadius: 8, background: "#fff", color: "#6b7280", fontFamily: MONO, fontSize: 15, display: "flex", alignItems: "center", padding: "0 12px" }}>🔒 {url}</div>
    </div>
    {crop ? (
      <div style={{ height: width * (crop.aspect ?? 0.58), overflow: "hidden", background: "#f6f7f9" }}>
        <Img src={staticFile(src)} style={{ width: `${crop.zoom * 100}%`, display: "block", transform: `translate(-${crop.left * 100}%, -${crop.top * 100}%)` }} />
      </div>
    ) : (
      <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
    )}
  </div>
);

export const Phone: React.FC<{ src: string; width: number; style?: React.CSSProperties }> = ({ src, width, style }) => (
  <div style={{ width, padding: width * 0.035, borderRadius: width * 0.16, background: "#0b0b12", boxShadow: "0 40px 100px -20px rgba(0,0,0,0.75), inset 0 0 0 2px rgba(255,255,255,0.08)", ...style }}>
    <Img src={staticFile(src)} style={{ width: "100%", display: "block", borderRadius: width * 0.125 }} />
  </div>
);

/** White flash + slight zoom at a cut, synced with the impacts in the music. */
export const CutFlash: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 2, 10], [0.0, 0.55, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "white", opacity: o, pointerEvents: "none" }} />;
};

/** Real-time counter badge. */
export const Timer: React.FC<{ seconds: number; label?: string }> = ({ seconds, label = "real time" }) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const v = useVertical();
  return (
    <div style={{ alignSelf: "flex-start", fontFamily: MONO, color: C.ink, background: "rgba(0,0,0,0.45)", border: `1px solid ${C.border}`, borderRadius: 999, padding: v ? "14px 28px" : "10px 22px", fontSize: v ? 40 : 30, display: "flex", gap: 14, alignItems: "center", backdropFilter: "blur(8px)" }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: "#ef4444", boxShadow: "0 0 12px #ef4444" }} />
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      <span style={{ fontFamily: FONT, fontSize: v ? 24 : 18, color: C.muted, textTransform: "uppercase", letterSpacing: 2 }}>{label}</span>
    </div>
  );
};
