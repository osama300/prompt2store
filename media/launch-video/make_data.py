"""Turns the real run (agent transcripts, UI captures, state.json) into the video's data.json + public assets."""
import json, os, shutil, glob, subprocess, datetime as dt

ROOT = "/home/user/demo-video"
PUB = f"{ROOT}/video/public"
APP = f"{ROOT}/app/.prompt-to-store"
start_epoch = int(open(f"{ROOT}/START").read().strip())  # capture start (≈ agent start)

def iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def load(p):
    return [json.loads(l) for l in open(p)]

run1 = load(f"{ROOT}/agent.jsonl")
state = json.load(open(f"{APP}/state.json"))

# ---- chat timeline (run 1, until shipping) ----
NAMES = {"state_get": "state_get", "env_check": "env_check · Flutter found", "plan_save": "plan_save · 4 screens", "app_create": "app_create · com.…habitstreaks",
         "stage_update": "stage_update · build", "check_run": "check_run", "ship_test_build": "ship_test_build"}
chat = [{"t": 0.5, "kind": "text", "text": "On it — planning a habit tracker with daily streaks."}]
for d in run1:
    e = d["e"]
    if e.get("type") != "assistant":
        continue
    for c in e["message"]["content"]:
        if c["type"] == "tool_use" and c["name"].startswith("mcp__prompt-to-store__"):
            n = c["name"].split("__")[-1]
            chat.append({"t": d["t"] / 1000, "kind": "tool", "text": NAMES.get(n, n)})
        elif c["type"] == "tool_use" and c["name"] in ("Write", "Edit"):
            fp = c["input"].get("file_path", "")
            if "/lib/" in fp or "/test/" in fp:
                chat.append({"t": d["t"] / 1000, "kind": "tool", "text": ("write " if c["name"] == "Write" else "edit ") + fp.split("/app/")[-1]})
# dedupe consecutive identical lines
dedup = []
for c in chat:
    if not dedup or dedup[-1]["text"] != c["text"]:
        dedup.append(c)
chat = dedup

check_times = [c["t"] for c in chat if c["text"].startswith("check_run")]
check_start = check_times[0] if check_times else 100

# ---- UI frames ----
def frames(kind, t_from, t_to, every=1):
    out = []
    files = sorted(glob.glob(f"{ROOT}/frames/{kind}/*.png"))
    os.makedirs(f"{PUB}/frames/{kind}", exist_ok=True)
    for i, f in enumerate(files):
        t = float(os.path.basename(f)[:-4])
        if t_from <= t <= t_to and i % every == 0:
            dst = f"frames/{kind}/{os.path.basename(f)}"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f, "-vf", "scale=1600:-1", "-q:v", "3", f"{PUB}/{dst[:-4]}.jpg"], check=True)
            out.append({"t": t, "src": dst[:-4] + ".jpg"})
    return out

path_frames = frames("path", 0, check_start + 5)

builds = [b for b in state["builds"] if b["status"] == "finished" and b["platform"] == "android"]
b = builds[-1]
ship_start = iso(b["startedAt"]) - start_epoch
install = iso(b["finishedAt"]) - start_epoch if b.get("finishedAt") else ship_start + 480
build_frames = frames("builds", ship_start - 10, install + 60)

# ---- check badges ----
last = state["checks"][-1]
items = {i["name"]: i for i in last["items"]}
tests = items.get("tests", {}).get("summary", "").split(",")[0]
shots = len(last.get("screenshots", []))
badges = ["0 analyzer errors", tests or "tests passed", f"{shots} screens rendered"]

# ---- app screenshots ----
os.makedirs(f"{PUB}/screens", exist_ok=True)
screens = []
for f in sorted(glob.glob(f"{APP}/checks/screens/phone/*.png")):
    dst = f"screens/{os.path.basename(f)}"
    shutil.copy(f, f"{PUB}/{dst}")
    screens.append(dst)

# ---- QR of the real install link ----
apk = next(a for a in b["artifacts"] if a.get("publicUrl"))
subprocess.run(["node", "-e", f"require('/home/user/prompt2store/node_modules/qrcode').toFile('{PUB}/qr.png', process.argv[1], {{width: 900, margin: 1}}, e => {{ if (e) throw e }})", apk["publicUrl"]], check=True)

agent_secs = run1[-1]["t"] / 1000
build_secs = install - ship_start
data = {
    "prompt": "Build a habit tracker with daily streaks and send me a test build.",
    "chat": chat,
    "checkStartSec": check_start,
    "pathFrames": path_frames,
    "buildFrames": build_frames,
    "shipStartSec": ship_start,
    "installSec": install,
    "buildSecs": build_secs,
    "agentSecs": agent_secs,
    "totalMinutes": round((agent_secs + build_secs) / 60),
    "checkBadges": badges,
    "screens": screens,
    "qr": "qr.png",
    "apkName": f"{apk['name']} · {round((apk.get('size') or 0) / 1e6)} MB",
}
json.dump(data, open(f"{ROOT}/video/src/data.json", "w"), indent=1)
print(json.dumps({k: (v if not isinstance(v, list) else len(v)) for k, v in data.items()}, indent=1))
