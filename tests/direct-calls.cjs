// Accounts and tap-to-call, end to end, in two separate browsers.
// Creates test accounts tstmom / tstnani (password secret123) through the "family"
// function if they don't exist, and Mom saves Nani as a contact.
// Needs a build with Supabase settings (.env.local) and `npm run preview`.
// Afterwards, delete the test users in Supabase (Authentication → Users) if you like.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function browser(name) {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && console.log(`  ${name} console: ${m.text()}`));
  return { b, page };
}

async function signIn(page, username) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.getByTestId('my-username').waitFor({ timeout: 15000 });
}

const status = (p) => p.getByTestId('call-status').innerText();
const waitStatus = (p, text, timeout = 20000) =>
  p.waitForFunction((t) => document.querySelector('[data-testid="call-status"]')?.textContent?.includes(t), text, { timeout });

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
async function family(action, body = {}, token) {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/family`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.VITE_SUPABASE_ANON_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  return res.json();
}
async function token(username) {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: `${username}@users.familycall.app`, password: 'secret123' }),
  });
  return (await res.json()).access_token;
}

(async () => {
  await family('signup', { firstName: 'Test', lastName: 'Mom', username: 'tstmom', password: 'secret123' });
  await family('signup', { firstName: 'Test', lastName: 'Nani', username: 'tstnani', password: 'secret123' });
  await family('addContact', { username: 'tstnani' }, await token('tstmom'));
  const mom = await browser('Mom');
  const nani = await browser('Nani');
  try {
    // Wrong password
    await mom.page.goto(`${BASE}/login`);
    await mom.page.getByLabel('Username').fill('tstmom');
    await mom.page.getByLabel('Password', { exact: true }).fill('wrongpass');
    await mom.page.getByRole('button', { name: 'Sign in' }).last().click();
    await mom.page.getByText('Wrong username or password.').waitFor();
    console.log('wrong password rejected');

    await signIn(nani.page, 'tstnani');
    await signIn(mom.page, 'tstmom');
    console.log('both signed in:', await mom.page.getByTestId('my-username').innerText(), '/', await nani.page.getByTestId('my-username').innerText());
    await mom.page.locator('.contact', { hasText: 'Test Nani' }).waitFor();
    await mom.page.waitForTimeout(1500); // let Nani's heartbeat land
    await mom.page.reload();
    await mom.page.locator('.contact', { hasText: 'Test Nani' }).waitFor();
    console.log('Mom sees Nani:', await mom.page.locator('.contact').first().innerText().then((t) => t.replace(/\n/g, ' | ')));
    await mom.page.screenshot({ path: path.join(OUT, 'family-home.png'), fullPage: true });

    // 1. Call → accept → connected
    await mom.page.getByRole('link', { name: 'Video call Test Nani' }).click();
    await waitStatus(mom.page, 'Ringing');
    const t0 = Date.now();
    await nani.page.getByRole('alertdialog').waitFor({ timeout: 15000 });
    console.log(`Nani's phone rang after ${Date.now() - t0} ms:`, await nani.page.locator('#incoming-name').innerText());
    await mom.page.screenshot({ path: path.join(OUT, 'outgoing-ringing.png') });
    await nani.page.screenshot({ path: path.join(OUT, 'incoming-call.png') });
    await nani.page.getByRole('button', { name: 'Accept' }).click();
    await Promise.all([waitStatus(mom.page, 'Connected'), waitStatus(nani.page, 'Connected')]);
    console.log('accepted → connected. Mom sees:', await mom.page.locator('.call__title').innerText(), '| Nani sees:', await nani.page.locator('.call__title').innerText());
    await mom.page.waitForTimeout(1000);
    await mom.page.screenshot({ path: path.join(OUT, 'direct-connected.png') });

    // 2. Mom hangs up → Nani sees "Call ended"
    await mom.page.getByRole('button', { name: 'End call' }).click();
    await waitStatus(nani.page, 'Call ended');
    console.log('Mom hung up → Nani:', await status(nani.page));
    await nani.page.getByRole('button', { name: 'Back home' }).click();
    await nani.page.getByTestId('my-username').waitFor();

    // 3. Decline
    await mom.page.getByRole('link', { name: 'Video call Test Nani' }).click();
    await nani.page.getByRole('alertdialog').waitFor({ timeout: 15000 });
    await nani.page.getByRole('button', { name: 'Decline' }).click();
    await waitStatus(mom.page, 'Declined', 15000);
    console.log('Nani declined → Mom:', await status(mom.page), '/', await mom.page.locator('.call__calling p').innerText());
    await mom.page.screenshot({ path: path.join(OUT, 'outgoing-declined.png') });
    await mom.page.getByRole('button', { name: 'Back home' }).click();
    await mom.page.getByTestId('my-username').waitFor();

    // 4. Caller cancels before answer → Nani's ringing stops, missed call shown
    await mom.page.getByRole('link', { name: 'Video call Test Nani' }).click();
    await nani.page.getByRole('alertdialog').waitFor({ timeout: 15000 });
    await waitStatus(mom.page, 'Ringing');
    await mom.page.waitForTimeout(1500); // make sure the call id is known
    await mom.page.getByRole('button', { name: 'End call' }).click();
    await nani.page.getByRole('alertdialog').waitFor({ state: 'detached', timeout: 15000 });
    console.log('Mom cancelled → Nani stopped ringing');
    const banner = await nani.page.locator('.banner--missed').innerText({ timeout: 10000 }).catch(() => '(no banner)');
    console.log('Nani missed-call banner:', banner.replace(/\n/g, ' | '));
    await nani.page.reload();
    await nani.page.locator('.recent__item').first().waitFor();
    console.log('Nani recent calls:', (await nani.page.locator('.recent__item .contact__status').allInnerTexts()).slice(0, 3).join(' || '));
    await nani.page.screenshot({ path: path.join(OUT, 'family-home-nani.png'), fullPage: true });

    // 5. Sign up a new account through the UI and add Mom
    const riya = await browser('Riya');
    try {
      await riya.page.goto(`${BASE}/login?mode=signup`);
      await riya.page.getByLabel('First name').fill('Tstriya');
      await riya.page.getByLabel('Last name').fill('Kumar');
      await riya.page.waitForFunction(() => document.querySelector('#username')?.value, null, { timeout: 10000 });
      await riya.page.getByText('Available').waitFor({ timeout: 10000 });
      const suggested = await riya.page.locator('#username').inputValue();
      console.log('suggested username for "Tstriya Kumar":', suggested);
      await riya.page.screenshot({ path: path.join(OUT, 'signup.png') });
      await riya.page.getByLabel('Password', { exact: true }).fill('secret123');
      await riya.page.getByRole('button', { name: 'Create account' }).last().click();
      await riya.page.getByTestId('my-username').waitFor({ timeout: 15000 });
      await riya.page.getByLabel('Add a family member').fill('tstmom');
      await riya.page.getByRole('button', { name: 'Add', exact: true }).click();
      await riya.page.locator('.contact', { hasText: 'Test Mom' }).waitFor({ timeout: 10000 });
      console.log('new account created and added Mom:', await riya.page.getByTestId('my-username').innerText());
      await riya.page.getByLabel('Add a family member').fill('nosuchperson');
      await riya.page.getByRole('button', { name: 'Add', exact: true }).click();
      console.log('unknown username:', await riya.page.locator('#add-error').innerText());
    } finally {
      await riya.b.close();
    }
  } finally {
    await mom.b.close();
    await nani.b.close();
  }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
