// "My video: Auto / Tall / Wide": the sender picks the shape, the receiver gets it.
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = path.join(__dirname, 'screenshots');

async function person(name, room, device) {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext(device ? { ...devices[device] } : { viewport: { width: 1280, height: 800 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ${name} pageerror: ${e.message}`));
  await page.addInitScript(() => localStorage.removeItem('familycall:effects'));
  await page.goto(`${BASE}/room/${room}`);
  await page.getByLabel('Your name').fill(name);
  return { b, page };
}
const received = (p) => p.evaluate(() => { const v = document.querySelector('video.call__remote'); return `${v.videoWidth}x${v.videoHeight}`; });
const shapeOf = (size) => { const [w, h] = size.split('x').map(Number); return w > h * 1.2 ? 'wide' : h > w * 1.2 ? 'tall' : 'square-ish'; };

(async () => {
  const room = `shape-${Date.now().toString(36)}`;
  const mom = await person('Mom', room);
  console.log('lobby button:', await mom.page.getByTestId('shape-button').innerText());
  await mom.page.getByRole('button', { name: 'Join call' }).click();
  const nani = await person('Nani', room, 'Pixel 7');
  await nani.page.getByRole('button', { name: 'Join call' }).click();
  await nani.page.waitForFunction(() => document.querySelector('video.call__remote')?.videoWidth > 0, null, { timeout: 30000 });
  await nani.page.waitForTimeout(2000);
  for (let i = 0; i < 4; i++) {
    const label = await mom.page.getByTestId('shape-button').innerText();
    const size = await received(nani.page);
    const fit = await nani.page.evaluate(() => getComputedStyle(document.querySelector('video.call__remote')).objectFit);
    console.log(`${label.padEnd(16)} → Nani receives ${size} (${shapeOf(size)}), shown with ${fit}`);
    if (i === 1) await nani.page.screenshot({ path: path.join(OUT, 'shape-tall-on-phone.png') });
    if (i < 3) {
      await mom.page.getByTestId('shape-button').click();
      await nani.page.waitForTimeout(3000);
    }
  }
  console.log('still connected:', (await nani.page.getByTestId('call-status').innerText()).includes('Connected'));
  console.log('effects button lit by shape alone:', await mom.page.locator('.call__controls .round-btn.is-active').count() > 0);
  await mom.b.close();
  await nani.b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
