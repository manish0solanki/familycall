const { chromium } = require('playwright');
const OUT = process.argv[2] || require('path').join(__dirname, 'screenshots');
require('fs').mkdirSync(OUT, { recursive: true });
const BASE = process.argv[3] || 'http://localhost:4173';

const status = (p) => p.getByTestId('call-status').innerText();
async function waitStatus(p, text, who) {
  await p.waitForFunction(
    (t) => document.querySelector('[data-testid="call-status"]')?.textContent?.includes(t),
    text,
    { timeout: 20000 },
  );
  console.log(`  ${who}: "${await status(p)}"`);
}
async function remoteVideoSize(p) {
  return p.evaluate(() => {
    const v = document.querySelector('video.call__remote');
    return v ? `${v.videoWidth}x${v.videoHeight}` : 'none';
  });
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const errors = [];
  const watch = (p, who) => {
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${who} console: ${m.text()}`));
  };

  const a = await ctx.newPage(); watch(a, 'A');
  await a.goto(BASE);
  await a.screenshot({ path: `${OUT}/1-home-phone.png` });
  await a.getByLabel('Your name').fill('Mom');
  await a.getByRole('button', { name: 'Start video call' }).click();
  await a.waitForURL(/\/room\//);
  const url = a.url();
  console.log('1. Mom started room', url);
  await a.waitForFunction(() => document.querySelector('video.preview__video')?.videoWidth > 0);
  await a.screenshot({ path: `${OUT}/2-lobby-phone.png` });
  await a.getByRole('button', { name: 'Join call' }).click();
  await waitStatus(a, 'Waiting', 'Mom');
  await a.screenshot({ path: `${OUT}/3-waiting-phone.png` });

  console.log('2. Nani joins via link');
  const b = await ctx.newPage(); watch(b, 'B');
  await b.goto(url);
  await b.getByLabel('Your name').fill('Nani');
  await b.getByRole('button', { name: 'Join call' }).click();
  await waitStatus(a, 'Connected', 'Mom');
  await waitStatus(b, 'Connected', 'Nani');
  console.log('  Mom sees title:', await a.locator('.call__title').innerText(), '| Nani sees title:', await b.locator('.call__title').innerText());
  await a.waitForFunction(() => document.querySelector('video.call__remote')?.videoWidth > 0, null, { timeout: 15000 });
  await b.waitForFunction(() => document.querySelector('video.call__remote')?.videoWidth > 0, null, { timeout: 15000 });
  console.log('  remote video Mom:', await remoteVideoSize(a), '| Nani:', await remoteVideoSize(b));
  const audio = await a.evaluate(() => document.querySelector('video.call__remote').srcObject.getAudioTracks().length);
  console.log('  remote audio tracks at Mom:', audio);
  await a.bringToFront();
  await a.waitForTimeout(1500);
  await a.screenshot({ path: `${OUT}/4-in-call-phone.png` });

  console.log('3. Mute and camera toggles');
  await a.getByRole('button', { name: 'Mute microphone' }).click();
  await a.getByRole('button', { name: 'Turn camera off' }).click();
  const tracks = await a.evaluate(() => ({
    micButtonPressed: document.querySelector('[aria-label="Unmute microphone"]')?.getAttribute('aria-pressed'),
    video: document.querySelector('video.call__self-video').srcObject.getVideoTracks()[0].enabled,
  }));
  console.log('  Mom local tracks enabled after toggles:', JSON.stringify(tracks));
  await a.screenshot({ path: `${OUT}/5-muted-phone.png` });
  await a.getByRole('button', { name: 'Unmute microphone' }).click();
  await a.getByRole('button', { name: 'Turn camera on' }).click();

  console.log('4. Third person tries to join');
  const c = await ctx.newPage(); watch(c, 'C');
  await c.goto(url);
  await c.getByLabel('Your name').fill('Riya');
  await c.getByRole('button', { name: 'Join call' }).click();
  await c.getByText('This call already has two people').waitFor({ timeout: 15000 });
  console.log('  Riya sees: "This call already has two people"');
  await c.close();
  await waitStatus(a, 'Connected', 'Mom still');

  console.log('5. Nani hangs up');
  await b.getByRole('button', { name: 'End call' }).click();
  await b.waitForURL(BASE + '/');
  await waitStatus(a, 'Waiting', 'Mom');

  console.log('6. Nani rejoins');
  await b.goto(url);
  await b.getByRole('button', { name: 'Join call' }).click();
  await waitStatus(a, 'Connected', 'Mom');
  await waitStatus(b, 'Connected', 'Nani');

  console.log('7. Nani closes the tab without hanging up');
  await b.close({ runBeforeUnload: true });
  await waitStatus(a, 'Waiting', 'Mom');

  console.log('8. Desktop layout');
  const d = await ctx.newPage(); watch(d, 'D');
  await d.setViewportSize({ width: 1440, height: 900 });
  await d.goto(BASE);
  await d.screenshot({ path: `${OUT}/6-home-desktop.png` });
  await d.goto(url);
  await d.getByLabel('Your name').fill('Dad');
  await d.waitForFunction(() => document.querySelector('video.preview__video')?.videoWidth > 0);
  await d.screenshot({ path: `${OUT}/7-lobby-desktop.png` });
  await d.getByRole('button', { name: 'Join call' }).click();
  await waitStatus(d, 'Connected', 'Dad');
  await d.waitForTimeout(1500);
  await d.screenshot({ path: `${OUT}/8-in-call-desktop.png` });

  console.log('9. Bad code on home');
  await d.goto(BASE);
  await d.getByLabel('Room code or invite link').fill('!!');
  await d.getByRole('button', { name: 'Join', exact: true }).click();
  console.log('  error shown:', await d.locator('#code-error').isVisible());
  await d.getByLabel('Room code or invite link').fill(url);
  await d.getByRole('button', { name: 'Join', exact: true }).click();
  await d.waitForURL(url);
  console.log('  pasting full link opens the room:', d.url() === url);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No page errors.');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
