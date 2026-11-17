// Video effects end to end: A's camera is a portrait photo (tests/fixtures/portrait.y4m),
// A turns on effects, and we check what B actually receives in the call.
// Needs a build with Supabase settings (two separate browsers) and `npm run preview`.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = path.join(__dirname, 'screenshots');
const PHOTO = path.join(__dirname, 'fixtures', 'portrait.jpg');
const CAMERA = path.join(OUT, 'portrait.y4m');
fs.mkdirSync(OUT, { recursive: true });
// Turn the portrait photo into a looping "camera" video for Chrome (needs ffmpeg).
require('child_process').execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', PHOTO, '-vf',
  'scale=-2:480,pad=640:480:(ow-iw)/2:0:color=#556070,format=yuv420p', '-t', '3', '-r', '15', CAMERA]);

async function person(name, room, camera) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (camera) args.push(`--use-file-for-fake-video-capture=${camera}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`  ${name} console: ${m.text()}`));
  await page.goto(`${BASE}/room/${room}`);
  await page.getByLabel('Your name').fill(name);
  return { browser, page };
}

/** Samples B's incoming video: average colour of a region (fractions of the frame) and frame rate. */
async function sampleRemote(page, region) {
  return page.evaluate(async ([x0, y0, x1, y1]) => {
    const v = document.querySelector('video.call__remote');
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0);
    const d = ctx.getImageData(Math.floor(x0 * c.width), Math.floor(y0 * c.height),
      Math.max(1, Math.floor((x1 - x0) * c.width)), Math.max(1, Math.floor((y1 - y0) * c.height))).data;
    let r = 0, g = 0, b = 0, n = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    }
    // Frame rate over 2 s.
    const q0 = v.getVideoPlaybackQuality().totalVideoFrames;
    await new Promise((res) => setTimeout(res, 2000));
    const fps = (v.getVideoPlaybackQuality().totalVideoFrames - q0) / 2;
    return { rgb: [r / n, g / n, b / n].map(Math.round), saturation: Math.round(sat / n), fps, size: `${c.width}x${c.height}` };
  }, region);
}

async function pickEffect(page, tab, label) {
  if (!(await page.locator('.sheet').count())) {
    await page.getByRole('button', { name: /^Effects/ }).click();
  }
  await page.getByRole('tab', { name: tab }).click();
  await page.locator('.sheet').getByRole('button', { name: label, exact: true }).click();
}

const TOP_LEFT = [0.02, 0.02, 0.12, 0.12];
const CENTER = [0.4, 0.35, 0.6, 0.55];

(async () => {
  const room = `fx-${Date.now().toString(36)}`;
  const a = await person('Mom', room, CAMERA);
  const b = await person('Nani', room);
  try {
    // Pick effects in the lobby before joining.
    await a.page.getByRole('button', { name: /^Effects/ }).click();
    await a.page.locator('.sheet').waitFor();
    await a.page.waitForTimeout(500);
    await a.page.screenshot({ path: path.join(OUT, 'effects-sheet.png') });
    await pickEffect(a.page, 'Background', 'Blur');
    const t0 = Date.now();
    await a.page.locator('.sheet__note').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
    console.log(`segmentation model ready after ${Date.now() - t0} ms (status note gone)`);
    await a.page.waitForTimeout(1500);
    await a.page.screenshot({ path: path.join(OUT, 'effects-blur-lobby.png') });
    await a.page.getByRole('button', { name: 'Done' }).click();

    await a.page.getByRole('button', { name: 'Join call' }).click();
    await b.page.getByRole('button', { name: 'Join call' }).click();
    const connected = (p) => p.waitForFunction(() => document.querySelector('[data-testid="call-status"]')?.textContent?.includes('Connected'), null, { timeout: 30000 });
    await Promise.all([connected(a.page), connected(b.page)]);
    await b.page.waitForFunction(() => document.querySelector('video.call__remote')?.videoWidth > 0, null, { timeout: 15000 });
    console.log('connected with effects on');

    await b.page.waitForTimeout(2000);
    console.log('blur      corner:', JSON.stringify(await sampleRemote(b.page, TOP_LEFT)));
    await b.page.screenshot({ path: path.join(OUT, 'effects-remote-blur.png') });

    // Change effects mid-call.
    for (const [tab, label, shot] of [
      ['Background', 'Beach sunset', 'beach'],
      ['Background', 'Festive lights', 'festive'],
      ['Filters', 'B&W', 'bw'],
    ]) {
      await pickEffect(a.page, tab, label);
      await b.page.waitForTimeout(2500);
      const corner = await sampleRemote(b.page, TOP_LEFT);
      const center = await sampleRemote(b.page, CENTER);
      console.log(`${shot.padEnd(9)} corner: ${JSON.stringify(corner)} centre: ${JSON.stringify(center.rgb)} sat ${center.saturation}`);
      await b.page.screenshot({ path: path.join(OUT, `effects-remote-${shot}.png`) });
    }
    await pickEffect(a.page, 'Filters', 'None');
    await a.page.getByRole('tab', { name: 'Beautify' }).click();
    await a.page.getByRole('radio', { name: 'High' }).click();
    await b.page.waitForTimeout(2000);
    await b.page.screenshot({ path: path.join(OUT, 'effects-remote-beauty.png') });

    // Everything off: raw camera again, call still flowing.
    await a.page.getByRole('button', { name: 'Reset all' }).click();
    await b.page.waitForTimeout(2500);
    const off = await sampleRemote(b.page, TOP_LEFT);
    console.log('all off   corner:', JSON.stringify(off));
    await b.page.screenshot({ path: path.join(OUT, 'effects-remote-off.png') });
    console.log('still connected:', (await b.page.getByTestId('call-status').innerText()).includes('Connected'));
  } finally {
    await a.browser.close();
    await b.browser.close();
  }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
