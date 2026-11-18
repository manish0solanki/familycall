// "Normal view / Wide angle": wide angle switches the camera to its full (4:3) sensor
// picture and its widest zoom, without cropping; the other person receives it.
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:4173';

async function person(name, room, device) {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext(device ? { ...devices[device] } : { viewport: { width: 1280, height: 800 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ${name} pageerror: ${e.message}`));
  await page.addInitScript(() => { localStorage.removeItem('familycall:view'); localStorage.setItem('familycall:debug', '1'); });
  await page.goto(`${BASE}/room/${room}`);
  await page.getByLabel('Your name').fill(name);
  return { b, page };
}
const received = (p) => p.evaluate(() => { const v = document.querySelector('video.call__remote'); return `${v.videoWidth}x${v.videoHeight}`; });
const readout = (p) => p.getByTestId('video-sizes').innerText();

(async () => {
  const room = `view-${Date.now().toString(36)}`;
  const mom = await person('Mom', room, 'Pixel 7');
  console.log('lobby button:', await mom.page.getByTestId('view-button').innerText());
  await mom.page.getByRole('button', { name: 'Join call' }).click();
  const nani = await person('Nani', room);
  await nani.page.getByRole('button', { name: 'Join call' }).click();
  await nani.page.waitForFunction(() => document.querySelector('video.call__remote')?.videoWidth > 0, null, { timeout: 30000 });
  await mom.page.getByTestId('video-sizes').waitFor();
  await mom.page.waitForTimeout(6000);
  console.log('Normal  :', await readout(mom.page), '| Nani receives', await received(nani.page));
  await mom.page.getByTestId('view-button').click();
  await mom.page.waitForTimeout(6000);
  console.log('Wide    :', await readout(mom.page), '| Nani receives', await received(nani.page), '| button:', await mom.page.getByTestId('view-button').innerText());
  await mom.page.getByTestId('view-button').click();
  await mom.page.waitForTimeout(4000);
  console.log('Normal  :', await readout(mom.page), '| Nani receives', await received(nani.page));
  console.log('still connected:', (await nani.page.getByTestId('call-status').innerText()).includes('Connected'));
  await mom.b.close();
  await nani.b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
