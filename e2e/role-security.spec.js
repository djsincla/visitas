import { test, expect } from '@playwright/test';

// Bounded security-user workflow. Depends on the 'guard' user created in the
// admin spec (we share a single backend across the suite).

test('security: forced password change → lands on Active visitors only', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('guard');
  await page.getByLabel('Password').fill('GuardPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();

  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('Current password').fill('GuardPass1234');
  await page.getByLabel('New password', { exact: true }).fill('GuardNewPass1234');
  await page.getByLabel('Confirm new password').fill('GuardNewPass1234');
  await page.getByRole('button', { name: 'Update password' }).click();

  await expect(page.getByRole('heading', { name: 'Active visitors' })).toBeVisible();

  // Topbar: Active visitors yes; Users / Kiosks / Settings hidden.
  await expect(page.getByRole('link', { name: 'Active visitors' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Kiosks' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
});

test('security: cannot reach admin URLs by typing them', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('guard');
  await page.getByLabel('Password').fill('GuardNewPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();

  // Wait for the post-login topbar to confirm the session cookie landed
  // before we start hitting protected URLs — otherwise the goto can race
  // ahead of the Set-Cookie response and the SPA shows /login again.
  await expect(page.getByRole('link', { name: 'Active visitors' })).toBeVisible();

  // Direct nav to /admin/users redirects to /admin/active-visitors.
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Active visitors' })).toBeVisible();

  await page.goto('/admin/kiosks');
  await expect(page.getByRole('heading', { name: 'Active visitors' })).toBeVisible();

  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Active visitors' })).toBeVisible();
});

test('security: force-signs-out a visitor', async ({ page, context }) => {
  // Sign in a visitor first via the public kiosk surface. v0.7+ flow is
  // multi-stage: form → safety → NDA + signature → submit. We block the
  // print popup so it doesn't open a stray tab.
  const kiosk = await context.newPage();
  await kiosk.addInitScript(() => { window.open = () => null; });
  await kiosk.goto('/kiosk/default');
  await kiosk.getByLabel(/Your name/).fill('Walk-In Wanda');
  await kiosk.getByPlaceholder(/Type a name…/).fill('Jane');
  await kiosk.getByRole('button', { name: 'Jane Host' }).click();
  await kiosk.getByLabel(/Reason for visit/).selectOption('Meeting');
  await kiosk.getByRole('button', { name: 'Continue' }).click();

  // Safety briefing (active from the admin spec).
  await kiosk.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await kiosk.getByRole('button', { name: /I have read this/ }).click();

  // NDA + drawn signature (also active from admin spec).
  await kiosk.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  const pad = kiosk.locator('canvas.signature-pad');
  const padBox = await pad.boundingBox();
  await kiosk.mouse.move(padBox.x + 20, padBox.y + 20);
  await kiosk.mouse.down();
  await kiosk.mouse.move(padBox.x + 200, padBox.y + 100, { steps: 10 });
  await kiosk.mouse.up();
  await kiosk.getByRole('button', { name: /I agree and sign/ }).click();
  await expect(kiosk.getByRole('heading', { name: /Thanks/ })).toBeVisible();

  // Now log in as guard.
  await page.goto('/login');
  await page.getByLabel('Username').fill('guard');
  await page.getByLabel('Password').fill('GuardNewPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();

  await expect(page.getByText('Walk-In Wanda')).toBeVisible();
  await page.getByRole('button', { name: 'Force sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();
  await expect(page.getByText('Walk-In Wanda')).not.toBeVisible();
});
