// Joining a call by QR code: by uploading a photo of the code, and with the camera.
// The camera test feeds a video of the QR code into Chrome's fake camera (needs ffmpeg).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  // 1. Mom starts a call; grab the QR code from her waiting screen.
  const host = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const hctx = await host.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
  await hctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const mom = await hctx.newPage();
  await mom.goto(BASE);
  await mom.getByRole('button', { name: 'Start video call' }).click();
  await mom.getByRole('button', { name: 'Join call' }).click();
  await mom.locator('.call__waiting svg[role="img"], .call__waiting .invite__qr svg').first().waitFor();
  await mom.waitForTimeout(800);
  await mom.screenshot({ path: path.join(OUT, 'waiting-phone.png') });
  const roomUrl = mom.url();
  const qrPng = path.join(OUT, 'invite-qr.png');
  await mom.locator('.call__waiting .invite__qr').screenshot({ path: qrPng });
  console.log('room:', roomUrl);

  // 2. Upload a photo of the QR code.
  const b1 = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const c1 = await b1.newContext({ viewport: { width: 412, height: 860 } });
  await c1.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const p1 = await c1.newPage();
  await p1.goto(BASE);
  await p1.getByRole('button', { name: 'Scan QR code' }).click();
  await p1.getByTestId('qr-file').setInputFiles(qrPng);
  await p1.waitForURL(roomUrl, { timeout: 10000 });
  console.log('upload photo → opened room:', p1.url() === roomUrl);
  await b1.close();

  // 3. Camera: make a video of the QR code and use it as the fake camera.
  const y4m = path.join(OUT, 'qr-camera.y4m');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', qrPng, '-vf',
    'scale=480:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p',
    '-t', '2', '-r', '10', y4m]);
  const b2 = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
  });
  const c2 = await b2.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
  await c2.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.getByRole('button', { name: 'Scan QR code' }).click();
  await p2.screenshot({ path: path.join(OUT, 'scanner-phone.png') });
  await p2.waitForURL(roomUrl, { timeout: 10000 });
  console.log('camera scan → opened room:', p2.url() === roomUrl);

  // 4. A photo without a QR code shows a friendly message (plain fake camera this time).
  const blank = path.join(OUT, 'no-qr.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=400x300', '-frames:v', '1', blank]);
  const b3 = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const c3 = await b3.newContext();
  await c3.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const p3 = await c3.newPage();
  await p3.goto(BASE);
  await p3.getByRole('button', { name: 'Scan QR code' }).click();
  await p3.getByTestId('qr-file').setInputFiles(blank);
  await p3.getByText('No QR code found').waitFor({ timeout: 5000 });
  console.log('photo without QR:', await p3.locator('.scanner__hint').innerText());
  await p3.getByRole('button', { name: 'Close scanner' }).click();
  console.log('scanner closes:', (await p3.locator('.scanner').count()) === 0);
  await b3.close();

  await b2.close();
  await host.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
