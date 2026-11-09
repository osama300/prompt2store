// Prefixes each stream-json line with elapsed ms so the video can show the agent's real timeline.
const start = Date.now(); let buf = '';
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) process.stdout.write(JSON.stringify({ t: Date.now() - start, e: JSON.parse(l) }) + '\n'); } });
