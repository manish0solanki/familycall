// Forgot-password flow with recovery codes, change password, and ringtone choice, through the UI.
// Creates a throwaway account "tstreset" (deleted users can be removed in Supabase afterwards).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  const username = 'tstreset';
  try {
    // Sign up → recovery code
    await page.goto(`${BASE}/login?mode=signup`);
    await page.getByLabel('First name').fill('Test');
    await page.getByLabel('Last name').fill('Reset');
    await page.getByLabel('Username').fill(username);
    await page.getByText('Available').waitFor({ timeout: 10000 });
    await page.getByLabel('Password', { exact: true }).fill('first111');
    await page.getByRole('button', { name: 'Create account' }).last().click();
    const codeEl = page.getByTestId('recovery-code');
    await codeEl.waitFor({ timeout: 15000 });
    const code1 = await codeEl.innerText();
    console.log('1. recovery code after sign-up:', code1.replace(/[A-Z0-9]/g, '•'));
    await page.screenshot({ path: path.join(OUT, 'recovery-code.png') });
    console.log('   Continue disabled until confirmed:', await page.getByRole('button', { name: 'Continue' }).isDisabled());
    await page.getByLabel('I’ve saved my recovery code').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('my-username').waitFor();
    console.log('   no reminder banner (code saved):', (await page.locator('.banner--warn').count()) === 0);

    // Sign out → forgot password
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Create account' }).waitFor(); // signed-out home
    await page.goto(`${BASE}/login`);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Recovery code').fill('AAAA-BBBB-CCCC-DDDD');
    await page.getByLabel('New password', { exact: true }).fill('second22');
    await page.getByRole('button', { name: 'Set new password' }).click();
    console.log('2. wrong code:', await page.locator('.field__error').innerText());
    await page.getByLabel('Recovery code').fill(code1.toLowerCase().replace(/-/g, ' '));
    await page.screenshot({ path: path.join(OUT, 'forgot-password.png') });
    await page.getByRole('button', { name: 'Set new password' }).click();
    await page.getByTestId('recovery-code').waitFor({ timeout: 15000 });
    const code2 = await page.getByTestId('recovery-code').innerText();
    console.log('   reset with code → new code shown, different from old:', code2 !== code1);
    console.log('   message:', await page.locator('.banner--ok').innerText());
    await page.getByLabel('I’ve saved my recovery code').check();
    await page.getByRole('button', { name: 'Continue to my family' }).click();
    await page.getByTestId('my-username').waitFor();
    console.log('   signed in after reset');

    // Old password no longer works; new one does
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Create account' }).waitFor(); // signed-out home
    await page.goto(`${BASE}/login`);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill('first111');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    console.log('3. old password:', await page.locator('.field__error').innerText());
    await page.getByLabel('Password', { exact: true }).fill('second22');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.getByTestId('my-username').waitFor();
    console.log('   new password works');

    // Change password in Settings (stays signed in)
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByLabel('Current password').fill('wrong999');
    await page.getByLabel('New password', { exact: true }).fill('third333');
    await page.getByRole('button', { name: 'Change password' }).click();
    console.log('4. wrong current password:', await page.locator('.account .field__error').innerText({ timeout: 10000 }));
    await page.getByLabel('Current password').fill('second22');
    await page.getByRole('button', { name: 'Change password' }).click();
    console.log('   ', await page.locator('.account .field__hint--ok').innerText({ timeout: 10000 }));
    await page.reload();
    await page.getByTestId('my-username').waitFor();
    console.log('   still signed in after changing password: true');

    // Ringtone choice is remembered
    await page.getByRole('radio', { name: 'Morning chimes' }).click();
    await page.reload();
    await page.getByTestId('my-username').waitFor();
    console.log('5. ringtone remembered:', await page.getByRole('radio', { name: 'Morning chimes' }).getAttribute('aria-checked'));
    await page.locator('#account').scrollIntoViewIfNeeded();
    await page.locator('#account').screenshot({ path: path.join(OUT, 'settings.png') });
  } finally {
    await b.close();
  }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
