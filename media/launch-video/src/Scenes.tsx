import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { C, FONT, MONO } from "./theme";
import { Backdrop, Browser, Grad, Phone, Timer, Title, usePop, useVertical } from "./ui";
import data from "./data.json";

type Frame = { t: number; src: string };
const pick = (frames: Frame[], t: number) => {
  let cur = frames[0];
  for (const fr of frames) if (fr.t <= t) cur = fr;
  return cur;
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* 1 · The prompt */
export const PromptScene: React.FC = () => {
  const frame = useCurrentFrame();
  const v = useVertical();
  const text = data.prompt;
  const chars = Math.floor(interpolate(frame, [8, 88], [0, text.length], clamp));
  const sent = frame > 96;
  const pop = usePop(0);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: v ? 60 : 160 }}>
        <div style={{ ...pop, width: "100%", maxWidth: 1400 }}>
          <div style={{ fontFamily: FONT, color: C.muted, fontSize: v ? 34 : 28, marginBottom: 22, display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 12, height: 12, borderRadius: 6, background: C.green, boxShadow: `0 0 14px ${C.green}` }} />
            Your coding agent
          </div>
          <div style={{ background: "rgba(255,255,255,0.07)", border: `1px solid ${sent ? C.indigo : C.border}`, borderRadius: 26, padding: v ? "40px 40px" : "38px 46px", fontFamily: FONT, color: C.ink, fontSize: v ? 58 : 54, lineHeight: 1.3, fontWeight: 600, boxShadow: sent ? `0 0 0 6px rgba(99,102,241,0.25)` : "none" }}>
            <span style={{ color: C.violet, marginRight: 18 }}>›</span>
            {text.slice(0, chars)}
            <span style={{ opacity: Math.floor(frame / 8) % 2 ? 1 : 0, color: C.cyan }}>▍</span>
          </div>
          <div style={{ marginTop: 26, fontFamily: MONO, fontSize: v ? 28 : 24, color: C.muted, opacity: interpolate(frame, [96, 104], [0, 1], clamp) }}>↵ sent</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* 2 · The agent works: chat + live UI + real timer */
export const WorkScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const v = useVertical();
  const { width } = useVideoConfig();
  // map scene frames -> real seconds of the run (timelapse until the check starts)
  const realT = interpolate(frame, [0, dur], [0, data.checkStartSec], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const ui = pick(data.pathFrames, realT);
  const items = data.chat.filter((c) => c.t <= realT).slice(-6);
  const chat = (
    <div style={{ width: v ? "100%" : 640, display: "flex", flexDirection: "column", gap: 14, fontFamily: FONT }}>
      {items.map((c, i) => (
        <div key={c.t + c.text} style={{ ...{ opacity: 1 }, alignSelf: "stretch", background: c.kind === "tool" ? "rgba(99,102,241,0.18)" : C.card, border: `1px solid ${c.kind === "tool" ? "rgba(99,102,241,0.5)" : C.border}`, borderRadius: 16, padding: "14px 20px", color: C.ink, fontSize: v ? 30 : 24, fontFamily: c.kind === "tool" ? MONO : FONT, transform: `translateY(${i === items.length - 1 ? interpolate(frame % 15, [0, 6], [10, 0], clamp) : 0}px)` }}>
          {c.kind === "tool" ? <span><span style={{ color: C.green }}>●</span> {c.text}</span> : c.text}
        </div>
      ))}
    </div>
  );
  const browser = <Browser src={ui.src} width={v ? width - 120 : 1060} crop={{ left: 0.31, top: 0.06, zoom: 1.5, aspect: v ? 0.75 : 0.62 }} />;
  return (
    <AbsoluteFill>
      <Backdrop hue={10} />
      <AbsoluteFill style={{ padding: v ? "90px 60px" : "70px 90px", flexDirection: v ? "column" : "row", gap: v ? 40 : 60, alignItems: v ? "stretch" : "center" }}>
        {v ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Title kicker="Plan → Build" title={<>It writes the <Grad>whole app</Grad></>} />
            </div>
            <Timer seconds={realT} label="agent time" />
            {browser}
            {chat}
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
              <Title kicker="Plan → Build" title={<>It writes<br />the <Grad>whole app</Grad></>} />
              {chat}
            </div>
            <div style={{ position: "relative" }}>
              {browser}
              <div style={{ position: "absolute", top: -26, right: -10 }}><Timer seconds={realT} label="agent time" /></div>
            </div>
          </>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* 3 · Check: results + screenshots fly in */
export const CheckScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const v = useVertical();
  const badges = data.checkBadges;
  return (
    <AbsoluteFill>
      <Backdrop hue={-20} />
      <AbsoluteFill style={{ padding: v ? "100px 60px" : "80px 100px", flexDirection: "column", gap: v ? 40 : 36 }}>
        <Title kicker="Check" title={<>Tested. <Grad>Every screen</Grad> rendered.</>} />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {badges.map((b, i) => {
            const p = usePop(8 + i * 6);
            return (
              <div key={b} style={{ ...p, fontFamily: FONT, fontSize: v ? 30 : 26, color: C.ink, background: "rgba(52,211,153,0.14)", border: "1px solid rgba(52,211,153,0.5)", borderRadius: 999, padding: "10px 22px" }}>
                <span style={{ color: C.green }}>✓</span> {b}
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, display: "flex", gap: v ? 24 : 40, justifyContent: "center", alignItems: "flex-end", flexWrap: "nowrap" }}>
          {data.screens.slice(0, v ? 3 : 4).map((src, i) => {
            const s = spring({ frame: frame - 20 - i * 7, fps, config: { damping: 13 } });
            const rot = (v ? [-6, 0, 6] : [-6, -2, 2, 6])[i];
            return (
              <div key={src} style={{ transform: `translateY(${(1 - s) * 700}px) rotate(${rot * (1 - s * 0.6)}deg)` }}>
                <Phone src={src} width={v ? 300 : 330} />
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: FONT, color: C.muted, fontSize: v ? 28 : 24, textAlign: "center", opacity: interpolate(frame, [50, 62], [0, 1], clamp) }}>
          Real screenshots from this run · rendered headlessly, no emulator
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* 4 · Ship: Codemagic build → QR */
export const ShipScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const v = useVertical();
  const { width } = useVideoConfig();
  const realT = interpolate(frame, [0, dur * 0.55], [data.shipStartSec, data.installSec], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const ui = pick(data.buildFrames, realT);
  const buildT = realT - data.shipStartSec;
  const zoom = interpolate(frame, [dur * 0.58, dur * 0.72], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill>
      <Backdrop hue={30} />
      <AbsoluteFill style={{ padding: v ? "100px 60px" : "70px 90px", flexDirection: v ? "column" : "row", gap: 60, alignItems: v ? "stretch" : "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 34, width: v ? "100%" : 620 }}>
          <Title kicker="Ship" title={<>Built in the cloud. <Grad>Yours to install.</Grad></>} />
          <div style={{ fontFamily: FONT, color: C.muted, fontSize: v ? 32 : 28, lineHeight: 1.4 }}>
            Committed, pushed and built on <b style={{ color: C.ink }}>your</b> Codemagic account — then a link and a QR code.
          </div>
          <Timer seconds={buildT} label="cloud build" />
        </div>
        <div style={{ position: "relative", flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ opacity: 1 - zoom, transform: `scale(${1 - zoom * 0.1})` }}>
            <Browser src={ui.src} width={v ? width - 120 : 1000} crop={{ left: 0.315, top: 0.07, zoom: 1.5, aspect: v ? 0.5 : 0.34 }} />
          </div>
          <div style={{ position: "absolute", opacity: zoom, transform: `scale(${0.7 + zoom * 0.3})`, background: "white", borderRadius: 32, padding: 34, boxShadow: "0 40px 120px -10px rgba(0,0,0,0.7)", textAlign: "center", fontFamily: FONT }}>
            <Img src={staticFile(data.qr)} style={{ width: v ? 520 : 420, display: "block" }} />
            <div style={{ fontWeight: 800, fontSize: 34, color: "#111", marginTop: 14 }}>Scan to install</div>
            <div style={{ fontSize: 22, color: "#6b7280", marginTop: 6 }}>{data.apkName}</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* 5 · The app on the phone */
export const PhoneScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const v = useVertical();
  const { fps } = useVideoConfig();
  const screens = data.screens;
  const per = dur / screens.length;
  const idx = Math.min(screens.length - 1, Math.floor(frame / per));
  const local = frame - idx * per;
  const slide = interpolate(local, [0, 10], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const enter = spring({ frame, fps, config: { damping: 15 } });
  const mins = data.totalMinutes;
  return (
    <AbsoluteFill>
      <Backdrop hue={-35} />
      <AbsoluteFill style={{ flexDirection: v ? "column" : "row", alignItems: "center", justifyContent: "center", gap: v ? 60 : 140, padding: v ? 60 : 100 }}>
        <div style={{ maxWidth: 760, textAlign: v ? "center" : "left" }}>
          <Title kicker="On your phone" title={<>From one sentence<br />to an app in <Grad>{mins} minutes</Grad></>} align={v ? "center" : "left"} />
          <div style={{ fontFamily: FONT, color: C.muted, fontSize: v ? 32 : 28, marginTop: 28 }}>Real run · agent + cloud build time · no code written by hand</div>
        </div>
        <div style={{ transform: `translateY(${(1 - enter) * 400}px)`, position: "relative" }}>
          <div style={{ transform: `translateX(${slide * 60}px)`, opacity: 1 - slide * 0.6 }}>
            <Phone src={screens[idx]} width={v ? 640 : 470} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* 6 · Store: publishing waits for your click */
export const StoreScene: React.FC = () => {
  const frame = useCurrentFrame();
  const v = useVertical();
  const click = frame > 62;
  const cx = interpolate(frame, [20, 58], [520, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const cy = interpolate(frame, [20, 58], [260, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const pop = usePop(0);
  return (
    <AbsoluteFill>
      <Backdrop hue={15} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 50, padding: 80 }}>
        <Title kicker="Store" title={<>Google Play & App Store —<br /><Grad>when you press Publish</Grad></>} align="center" />
        <div style={{ ...pop, position: "relative", background: "white", borderRadius: 28, padding: v ? "40px 44px" : "36px 48px", width: v ? 880 : 900, fontFamily: FONT, boxShadow: "0 40px 120px -20px rgba(0,0,0,0.7)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: "#111" }}>Publish to Google Play (internal)</div>
            <div style={{ fontSize: 22, padding: "6px 16px", borderRadius: 999, background: click ? "#dcfce7" : "#fef3c7", color: click ? "#166534" : "#92400e", fontWeight: 700 }}>{click ? "Approved" : "Waiting for you"}</div>
          </div>
          <div style={{ fontSize: 24, color: "#4b5563", marginTop: 14 }}>Nothing reaches a store until you confirm. Your keys never touch the chat.</div>
          <div style={{ display: "flex", gap: 18, marginTop: 28 }}>
            <div style={{ background: click ? "#4338ca" : C.indigo, color: "white", fontSize: 30, fontWeight: 700, borderRadius: 16, padding: "16px 44px", transform: `scale(${click && frame < 72 ? 0.94 : 1})` }}>Publish</div>
            <div style={{ border: "2px solid #fca5a5", color: "#dc2626", fontSize: 30, fontWeight: 700, borderRadius: 16, padding: "14px 40px" }}>Reject</div>
          </div>
          <div style={{ position: "absolute", left: 120 + cx, top: (v ? 250 : 230) + cy, fontSize: 56, filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.35))", opacity: interpolate(frame, [14, 20], [0, 1], clamp) }}>👆</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* 7 · Outro */
export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVertical();
  const s = spring({ frame, fps, config: { damping: 12 } });
  const cmd = "npx prompt-to-store";
  const chars = Math.floor(interpolate(frame, [30, 60], [0, cmd.length], clamp));
  const tag = usePop(18);
  const foot = usePop(66);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: v ? 44 : 34, padding: 80, textAlign: "center", fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, flexDirection: v ? "column" : "row", transform: `scale(${0.6 + 0.4 * s})`, opacity: s }}>
          <Img src={staticFile("logo.svg")} style={{ width: v ? 220 : 150 }} />
          <div style={{ color: C.ink, fontWeight: 800, fontSize: v ? 96 : 104, letterSpacing: -3 }}>prompt-to-store</div>
        </div>
        <div style={{ ...tag, color: "#e7e5ff", fontSize: v ? 46 : 42, fontWeight: 600, maxWidth: 1300, lineHeight: 1.3 }}>
          From one prompt to <Grad>Google Play</Grad> and the <Grad>App Store</Grad> — inside your coding agent.
        </div>
        <div style={{ fontFamily: MONO, fontSize: v ? 50 : 46, color: C.ink, background: "rgba(0,0,0,0.5)", border: `1px solid ${C.border}`, borderRadius: 18, padding: "18px 36px", opacity: interpolate(frame, [24, 30], [0, 1], clamp) }}>
          <span style={{ color: C.green }}>$</span> {cmd.slice(0, chars)}<span style={{ opacity: Math.floor(frame / 8) % 2 ? 1 : 0 }}>▍</span>
        </div>
        <div style={{ ...foot, color: C.muted, fontSize: v ? 32 : 28 }}>
          Open source · Free · Flutter · Works with Claude Code, Codex & Cursor
        </div>
        <div style={{ ...foot, color: C.cyan, fontSize: v ? 30 : 26, fontFamily: MONO }}>github.com/osama300/prompt2store</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
