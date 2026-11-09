import React from "react";
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { CUTS, FPS, TOTAL, f } from "./theme";
import { CheckScene, OutroScene, PhoneScene, PromptScene, ShipScene, StoreScene, WorkScene } from "./Scenes";
import { CutFlash } from "./ui";

const scenes: { from: number; to: number; el: (dur: number) => React.ReactNode; flash: boolean }[] = [
  { from: CUTS.prompt, to: CUTS.work, el: () => <PromptScene />, flash: false },
  { from: CUTS.work, to: CUTS.check, el: (d) => <WorkScene dur={d} />, flash: true },
  { from: CUTS.check, to: CUTS.ship, el: () => <CheckScene />, flash: true },
  { from: CUTS.ship, to: CUTS.phone, el: (d) => <ShipScene dur={d} />, flash: true },
  { from: CUTS.phone, to: CUTS.store, el: (d) => <PhoneScene dur={d} />, flash: true },
  { from: CUTS.store, to: CUTS.outro, el: () => <StoreScene />, flash: false },
  { from: CUTS.outro, to: CUTS.end, el: () => <OutroScene />, flash: true },
];

/** Each scene zooms in slightly at its start (punch on the beat) and blurs out at its end. */
const SceneShell: React.FC<{ dur: number; last: boolean; children: React.ReactNode }> = ({ dur, last, children }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 8], [1.06, 1], { extrapolateRight: "clamp" });
  const out = last ? 0 : interpolate(frame, [dur - 6, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ transform: `scale(${scale + out * 0.04})`, filter: `blur(${out * 10}px)`, opacity: 1 - out * 0.5 }}>{children}</AbsoluteFill>
  );
};

const Video: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [TOTAL - 30, TOTAL], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#0b0a16", opacity: fadeOut }}>
      <Audio src={staticFile("track.wav")} />
      {scenes.map((s, i) => {
        const from = f(s.from);
        const dur = (i === scenes.length - 1 ? TOTAL : f(s.to)) - from;
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <SceneShell dur={dur} last={i === scenes.length - 1}>{s.el(dur)}</SceneShell>
            {s.flash && <CutFlash />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <>
    <Composition id="Landscape" component={Video} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    <Composition id="Vertical" component={Video} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
  </>
);
