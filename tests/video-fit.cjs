// Video fit: the receiver fills the screen when shapes match and shows the whole picture
// when they don't (tap / Fit button toggles). Note: Chrome's fake camera can't rotate like a
// real phone, so emulated phones send their uncropped 1280×720 frame.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function person(name, room, device) {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext(device ? { ...devices[device] } : { viewport: { width: 1280, height: 800 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ${name} pageerror: ${e.message}`));
  await page.goto(`${BASE}/room/${room}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join call' }).click();
  return { b, page };
}

const sent = (p) => p.evaluate(() => {
  const v = document.querySelector('video.call__self-video, video.call__bg');
  const t = v?.srcObject?.getVideoTracks()[0];
  const s = t?.getSettings() ?? {};
  return `${s.width}x${s.height}`;
});
const received = (p) => p.evaluate(() => {
  const v = document.querySelector('video.call__remote');
  return { size: `${v.videoWidth}x${v.videoHeight}`, fit: getComputedStyle(v).objectFit };
});
const connected = (p) => p.waitForFunction(() => document.querySelector('[data-testid="call-status"]')?.textContent?.includes('Connected'), null, { timeout: 30000 });
const hasVideo = (p) => p.waitForFunction(() => document.querySelector('video.call__remote')?.videoWidth > 0, null, { timeout: 15000 });

(async () => {
  // 1. Phone ↔ phone, both upright
  let room = `fit-${Date.now().toString(36)}`;
  const a = await person('Mom', room, 'Pixel 7');
  await a.page.getByTestId('call-status').waitFor();
  console.log('phone camera while waiting (uncropped camera size; real phones rotate it upright):', await sent(a.page));
  const b = await person('Nani', room, 'Pixel 7');
  await Promise.all([connected(a.page), connected(b.page)]);
  await hasVideo(b.page);
  await b.page.waitForTimeout(2500);
  console.log('1. phone→phone: Nani receives', JSON.stringify(await received(b.page)), '(fit follows shape: tall → cover on a phone, wide → contain)');
  await b.page.screenshot({ path: path.join(OUT, 'fit-phone-phone.png') });
  await a.b.close();
  await b.b.close();

  // 2. Computer (wide) → phone: show the whole picture; tap to fill
  room = `fit-${Date.now().toString(36)}b`;
  const c = await person('Dad', room, null);
  await c.page.getByTestId('call-status').waitFor();
  const d = await person('Riya', room, 'Pixel 7');
  await Promise.all([connected(c.page), connected(d.page)]);
  await hasVideo(d.page);
  await d.page.waitForTimeout(2500);
  console.log('2. computer→phone: Riya receives', JSON.stringify(await received(d.page)), '(expect wide video, contain)');
  await d.page.screenshot({ path: path.join(OUT, 'fit-computer-phone.png') });
  await d.page.getByTestId('fit-toggle').click();
  console.log('   after tap:', JSON.stringify(await received(d.page)));
  await d.page.getByTestId('fit-toggle').click();
  console.log('   tap again:', JSON.stringify(await received(d.page)));
  console.log('   computer receives phone video:', JSON.stringify(await received(c.page)), '(fit follows shape)');
  await c.b.close();
  await d.b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
