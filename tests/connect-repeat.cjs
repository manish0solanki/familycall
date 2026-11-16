const { chromium } = require('playwright');
const BASE = 'http://localhost:4173';
const RUNS = Number(process.argv[2] || 10);

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  let fails = 0;
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      window.__pcs = []; window.__sent = []; window.__recv = [];
      const P = window.RTCPeerConnection;
      window.RTCPeerConnection = function (...a) { const pc = new P(...a); window.__pcs.push(pc); return pc; };
      window.RTCPeerConnection.prototype = P.prototype;
      const post = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (m) { window.__sent.push(m.type + (m.description ? ':' + m.description.type : '')); return post.call(this, m); };
      const add = BroadcastChannel.prototype.addEventListener;
      BroadcastChannel.prototype.addEventListener = function (t, h) { return add.call(this, t, (e) => { window.__recv.push(e.data.type + (e.data.description ? ':' + e.data.description.type : '')); h(e); }); };
    });
    await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
    const logs = [];
    const room = `test-${Date.now()}-${i}`;
    const open = async (who) => {
      const p = await ctx.newPage();
      p.on('console', (m) => logs.push(`${who} ${m.type()}: ${m.text()}`));
      p.on('pageerror', (e) => logs.push(`${who} pageerror: ${e.message}`));
      await p.goto(`${BASE}/room/${room}`);
      await p.getByRole('button', { name: 'Join call' }).click();
      return p;
    };
    const a = await open('A');
    await a.getByTestId('call-status').filter({ hasText: 'Waiting' }).waitFor();
    const b = await open('B');
    const ok = async (p) =>
      p.waitForFunction(() => document.querySelector('[data-testid="call-status"]')?.textContent?.includes('Connected'), null, { timeout: 10000 })
        .then(() => true, () => false);
    const [ra, rb] = await Promise.all([ok(a), ok(b)]);
    if (!ra || !rb) {
      fails++;
      console.log(`run ${i}: FAIL A=${await a.getByTestId('call-status').innerText()} B=${await b.getByTestId('call-status').innerText()}`);
      console.log(logs.join('\n'));
      for (const [who, p] of [['A', a], ['B', b]]) {
        console.log(who, JSON.stringify(await p.evaluate(() => ({
          sent: window.__sent, recv: window.__recv,
          pcs: window.__pcs.map((pc) => ({ sig: pc.signalingState, ice: pc.iceConnectionState, conn: pc.connectionState, gather: pc.iceGatheringState,
            local: pc.localDescription?.type, remote: pc.remoteDescription?.type })),
        }))));
      }
    }
    await ctx.close();
  }
  console.log(`${fails}/${RUNS} failed`);
  await browser.close();
})();
