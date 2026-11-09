// Captures the local UI (path, check, builds) every ~2.5s until STOP exists. File names carry elapsed seconds.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const [base, out] = process.argv.slice(2); const u = new URL(base); const t = u.searchParams.get('t');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
  const p = await ctx.newPage(); const start = Date.now();
  await p.goto(`${u.origin}/?t=${t}`); await p.waitForTimeout(800);
  if (await p.evaluate(() => document.documentElement.dir === 'rtl')) await p.locator('button', { hasText: 'English' }).first().click();
  for (const r of ['path', 'check', 'builds']) fs.mkdirSync(path.join(out, r), { recursive: true });
  while (!fs.existsSync(path.join(out, '..', 'STOP'))) {
    for (const r of ['path', 'check', 'builds']) {
      await p.goto(`${u.origin}/${r === 'path' ? '' : r}?t=${t}`); await p.waitForTimeout(500);
      const s = ((Date.now() - start) / 1000).toFixed(1).padStart(7, '0');
      await p.screenshot({ path: path.join(out, r, `${s}.png`) });
    }
    await p.waitForTimeout(1200);
  }
  await b.close();
})();
