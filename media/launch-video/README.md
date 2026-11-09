# Launch video (source)

The 48-second demo in [`docs/assets/demo.mp4`](../../docs/assets/demo.mp4), as code. It is built from a **real run**, not a mock-up:

1. **Record a real run.**
   - `capture.cjs` screenshots the local UI every ~2 s.
   - `stamp.cjs` timestamps the agent's `stream-json` transcript.
   - Run both while a coding agent builds and ships an app.
2. **`python3 make_data.py`** turns the transcript, the UI captures and `state.json` into `src/data.json` and `public/`: UI frames, app screenshots and the QR code of the real install link. Paths at the top of the file point to the recording folder.
3. **`python3 compose.py`** synthesizes the original 128 BPM soundtrack (`track.wav`, needs `numpy`). Its sections line up with the scene cuts defined in `src/theme.ts`.
4. **`npm install && npm run render`** renders both formats with [Remotion](https://www.remotion.dev): landscape 1920×1080 and vertical 1080×1920.

Scenes live in `src/Scenes.tsx`. Timing is set in bars of the music (`CUTS` in `src/theme.ts`), so editing a scene keeps it on the beat.
