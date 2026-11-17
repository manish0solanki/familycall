// Calls between two completely separate browsers, so the only way they can find each
// other is through the real signaling server (Supabase Realtime). Needs a build made
// with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set.
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:4173';
const RUNS = Number(process.argv[3] || 5);

const statusText = (p) => p.getByTestId('call-status').innerText();
const waitFor = (p, text, timeout = 20000) =>
  p.waitForFunction((t) => document.querySelector('[data-testid="call-status"]')?.textContent?.includes(t), text, { timeout });

async function person(name, room) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext();
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => logs.push(`${((Date.now() % 100000) / 1000).toFixed(2)}s ${m.text()}`));
  await page.goto(`${BASE}/room/${room}?debug`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join call' }).click();
  return { browser, page, logs };
}

(async () => {
  let passed = 0;
  for (let i = 0; i < RUNS; i++) {
    const room = `tb-${Date.now().toString(36)}-${i}`;
    const mom = await person('Mom', room);
    try {
      await waitFor(mom.page, 'Waiting');
      const nani = await person('Nani', room);
      try {
        const t0 = Date.now();
        await Promise.all([waitFor(mom.page, 'Connected'), waitFor(nani.page, 'Connected')]);
        await mom.page.waitForFunction(() => document.querySelector('video.call__remote')?.videoWidth > 0, null, { timeout: 15000 });
        const ms = Date.now() - t0;
        await nani.page.getByRole('button', { name: 'End call' }).click();
        await waitFor(mom.page, 'Waiting');
        console.log(`run ${i}: connected in ${ms} ms, video flowing, hang-up seen by other side`);
        passed++;
      } catch (e) {
        console.log('  Mom log:\n    ' + mom.logs.join('\n    '));
        console.log('  Nani log:\n    ' + nani.logs.join('\n    '));
        console.log(`run ${i}: FAIL Mom="${await statusText(mom.page)}" Nani="${await statusText(nani.page).catch(() => '?')}" ${e.message.split('\n')[0]}`);
      } finally {
        await nani.browser.close();
      }
    } finally {
      await mom.browser.close();
    }
  }
  console.log(`${passed}/${RUNS} passed`);
  process.exit(passed === RUNS ? 0 : 1);
})();
