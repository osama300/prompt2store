"""Original launch track for the prompt-to-store video (128 BPM, A minor, 25 bars = 46.875 s).

Arrangement follows the video's cuts (bar = 1.875 s):
  bars 0-1   intro: pad + filtered arp + riser into the drop
  bar  2     DROP (scene 2 starts at 3.75 s)
  bars 2-18  full groove; impacts on scene changes (bars 7, 11, 15)
  bars 19-20 breakdown (store scene) with riser
  bars 21-24 final drop / outro, ends on a long chord
"""
import numpy as np
import wave

SR = 44100
BPM = 128
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 25
N = int(SR * BAR * BARS) + SR * 2  # 2 s tail
L = np.zeros(N)
R = np.zeros(N)

rng = np.random.default_rng(7)


def t_idx(t):
    return int(round(t * SR))


def env(n, a=0.005, d=0.1, s=0.6, r=0.1):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    return np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, s, d_n, endpoint=False),
        np.full(s_n, s),
        np.linspace(s, 0, r_n),
    ])[:n]


def lowpass(x, cutoff):
    """One-pole lowpass; cutoff may be an array (sweeps)."""
    cutoff = np.broadcast_to(cutoff, x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def saw(f, n, detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * f * (1 + detune) + phase) % 1.0) - 1


def add(buf_l, buf_r, start, sig, pan=0.0, gain=1.0):
    i = t_idx(start)
    j = min(len(buf_l), i + len(sig))
    sig = sig[: j - i] * gain
    buf_l[i:j] += sig * np.cos((pan + 1) * np.pi / 4)
    buf_r[i:j] += sig * np.sin((pan + 1) * np.pi / 4)


# ---------- drums ----------
def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 35)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7) + 0.3 * np.sin(ph * 2) * np.exp(-t * 30)


def clap():
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    bursts = sum(np.exp(-np.clip(t - k * 0.011, 0, None) * 60) * (t >= k * 0.011) for k in range(3))
    x = noise * (bursts * 0.5 + np.exp(-t * 18))
    return x - lowpass(x, 900)  # highpass-ish


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = x - lowpass(x, 7000)
    return x * np.exp(-t * (18 if open_ else 80))


def impact():
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (35 + 60 * np.exp(-t * 6)) * t) * np.exp(-t * 2.2)
    noise = lowpass(rng.standard_normal(n), 2500) * np.exp(-t * 3)
    return boom * 0.9 + noise * 0.5


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = lowpass(x, 300 + 9000 * (t / dur) ** 2)
    return x * (t / dur) ** 2


K, C, H, HO, IMP = kick(), clap(), hat(), hat(True), impact()

# ---------- harmony: Am - F - C - G ----------
PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # A3 C4 E4 / F3 A3 C4 / C3 E3 G3 / G3 B3 D4
BASS = [33, 29, 36, 31]  # A1 F1 C2 G1


def sidechain(n, bar_start_t):
    """Volume ducking on every beat (4-on-the-floor pump)."""
    t = np.arange(n) / SR + bar_start_t
    phase = (t % BEAT) / BEAT
    return 0.35 + 0.65 * np.clip(phase * 3.5, 0, 1)


def pad_bar(chord, start, full=True, cutoff=2500):
    n = int(BAR * SR)
    sig = np.zeros(n)
    for note in chord + [chord[0] + 12]:
        for d in (-0.006, 0.0, 0.007):
            sig += saw(hz(note), n, d, rng.random())
    sig = lowpass(sig / 12, cutoff) * env(n, 0.02, 0.2, 0.8, 0.15)
    if full:
        sig *= sidechain(n, start)
    return sig


def bass_bar(root, start):
    out = np.zeros(int(BAR * SR))
    for k in range(8):  # offbeat 8ths
        if k % 2 == 0:
            continue
        n = int(BEAT / 2 * SR)
        s = (saw(hz(root), n) + 0.6 * np.sin(2 * np.pi * hz(root - 12) * np.arange(n) / SR))
        s = lowpass(s, 700) * env(n, 0.003, 0.08, 0.7, 0.03)
        i = int(k * BEAT / 2 * SR)
        out[i:i + n] += s
    return out


def arp_bar(chord, cutoff):
    out = np.zeros(int(BAR * SR))
    notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24]
    for k in range(16):
        n = int(BEAT / 4 * SR)
        f = hz(notes[k % 4])
        s = saw(f, n) * 0.6 + np.sign(np.sin(2 * np.pi * f * np.arange(n) / SR)) * 0.4
        s = lowpass(s, cutoff) * env(n, 0.002, 0.05, 0.25, 0.04)
        i = int(k * BEAT / 4 * SR)
        out[i:i + n] += s
    return out


def lead_phrase(start, notes):
    """notes: list of (beat_offset, midi, beats)"""
    for off, m, ln in notes:
        n = int(ln * BEAT * SR)
        s = sum(saw(hz(m), n, d, rng.random()) for d in (-0.004, 0.004))
        s = lowpass(s / 2, 3800) * env(n, 0.01, 0.1, 0.6, 0.12)
        add(L, R, start + off * BEAT, s, pan=-0.2, gain=0.16)
        add(L, R, start + off * BEAT + BEAT * 0.75, s, pan=0.35, gain=0.06)  # echo


HOOK = [(0, 76, 1), (1, 74, 0.5), (1.5, 72, 0.5), (2, 74, 1), (3, 69, 1),
        (4, 72, 1), (5, 71, 0.5), (5.5, 69, 0.5), (6, 67, 1.5), (7.5, 69, 0.5),
        (8, 72, 1), (9, 74, 0.5), (9.5, 76, 0.5), (10, 79, 1), (11, 76, 1),
        (12, 74, 1), (13, 72, 0.5), (13.5, 71, 0.5), (14, 69, 2)]

breakdown = {19, 20}
for b in range(BARS):
    t0 = b * BAR
    chord, root = PROG[b % 4], BASS[b % 4]
    intro = b < 2
    full = not intro and b not in breakdown
    if intro:
        cut = np.linspace(400, 1800, int(BAR * SR))
        add(L, R, t0, pad_bar(chord, t0, False, 1200), gain=0.32)
        add(L, R, t0, lowpass(arp_bar(chord, 5000), cut), pan=0.3, gain=0.14)
    elif b in breakdown:
        add(L, R, t0, pad_bar(chord, t0, False, 1600), gain=0.34)
        add(L, R, t0, arp_bar(chord, 1500 + (b - 19) * 1500), pan=-0.3, gain=0.12)
    else:
        add(L, R, t0, pad_bar(chord, t0, True, 3200), gain=0.30)
        add(L, R, t0, bass_bar(root, t0), gain=0.42)
        add(L, R, t0, arp_bar(chord, 4200), pan=0.35, gain=0.12)
        for k in range(4):
            add(L, R, t0 + k * BEAT, K, gain=0.95)
            add(L, R, t0 + k * BEAT + BEAT / 2, HO if k == 3 else H, pan=0.25, gain=0.20)
            add(L, R, t0 + k * BEAT + BEAT / 4, H, pan=-0.25, gain=0.07)
            add(L, R, t0 + k * BEAT + 3 * BEAT / 4, H, pan=-0.25, gain=0.07)
        for k in (1, 3):
            add(L, R, t0 + k * BEAT, C, gain=0.45)

# lead hook in the high-energy sections
for b in (3, 7, 11, 15, 21):
    lead_phrase(b * BAR, HOOK)

# risers and impacts on the cuts
add(L, R, 2 * BAR - 1.8, riser(1.8), gain=0.35)
add(L, R, 21 * BAR - 3.6, riser(3.6), gain=0.4)
for b in (2, 7, 11, 15, 21):
    add(L, R, b * BAR, IMP, gain=0.6)

# final chord ring-out
n = int(3.0 * SR)
final = sum(saw(hz(m), n, d, rng.random()) for m in (45, 57, 60, 64, 69) for d in (-0.005, 0.005))
final = lowpass(final / 10, 2200) * env(n, 0.01, 0.4, 0.5, 2.4)
add(L, R, 24 * BAR + 2 * BEAT, final, gain=0.38)

# simple stereo reverb (feedback delays)
def reverb(x, delays=(0.031, 0.047, 0.061, 0.083), fb=0.55, mix=0.22):
    y = np.zeros_like(x)
    for d in delays:
        k = int(d * SR)
        buf = np.zeros_like(x)
        buf[k:] = x[:-k]
        for _ in range(3):
            shifted = np.zeros_like(buf)
            shifted[k:] = buf[:-k] * fb
            buf = buf + shifted
        y += buf
    return x + lowpass(y / len(delays), 5000) * mix

L, R = reverb(L), reverb(R, delays=(0.029, 0.043, 0.067, 0.079))

# fade-in first beat, fade-out tail, master
fade = np.ones(N)
fade[: int(0.3 * SR)] = np.linspace(0, 1, int(0.3 * SR))
end = int((BARS * BAR + 1.5) * SR)
fade[end:] = np.linspace(1, 0, N - end)
L, R = L * fade, R * fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(L / peak * 1.3) * 0.95, np.tanh(R / peak * 1.3) * 0.95

pcm = (np.stack([L, R], axis=1) * 32767).astype(np.int16)
with wave.open("/home/user/demo-video/music/track.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("ok", len(pcm) / SR, "seconds")
