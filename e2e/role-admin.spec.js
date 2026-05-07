import { test, expect } from '@playwright/test';

// Realistic full admin workflow. Runs first; subsequent specs depend on the
// security user 'guard' created here.

test('admin: bootstrap → forced password change → land on Users', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('admin');
  await page.getByRole('button', { name: /Sign in/ }).click();

  // Forced password change.
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('Current password').fill('admin');
  await page.getByLabel('New password', { exact: true }).fill('AdminNewPass1234');
  await page.getByLabel('Confirm new password').fill('AdminNewPass1234');
  await page.getByRole('button', { name: 'Update password' }).click();

  // Lands on Users page; topbar shows admin links.
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.locator('.brand-text')).toHaveText('visitas.world');
  await expect(page.getByRole('link', { name: 'Active visitors' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kiosks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('admin: enables NDA + safety documents', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('AdminNewPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();

  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  // Save default safety briefing (already populated). Click Save & enable.
  await page.getByRole('button', { name: 'Save & enable' }).first().click();
  await expect(page.getByText(/Active: v1/).first()).toBeVisible();

  // Save default NDA. Defaults are pre-filled in the textarea.
  await page.getByRole('button', { name: 'Save & enable' }).first().click();
  // Both should now show Active: v1.
  await expect(page.locator('text=Active: v1').nth(1)).toBeVisible();
});

test('admin: creates an admin host and a security user', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('AdminNewPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();

  // Create a host (role=admin).
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: '+ Add user' }).click();
  await page.getByLabel(/Role/).selectOption('admin');
  await page.getByLabel(/Username/).fill('jane');
  await page.getByLabel(/Initial password/).fill('JanePass12345');
  await page.getByLabel(/Display name/).fill('Jane Host');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('cell', { name: 'jane', exact: true })).toBeVisible();

  // Create a security user.
  await page.getByRole('button', { name: '+ Add user' }).click();
  await page.getByLabel(/Role/).selectOption('security');
  await page.getByLabel(/Username/).fill('guard');
  await page.getByLabel(/Initial password/).fill('GuardPass1234');
  await page.getByLabel(/Display name/).fill('Guard One');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('cell', { name: 'guard', exact: true })).toBeVisible();
});

test('admin: configures kiosks (default + loading dock with printer)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('AdminNewPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();

  await page.getByRole('link', { name: 'Kiosks' }).click();
  await expect(page.getByRole('heading', { name: 'Kiosks' })).toBeVisible();
  // Default kiosk is seeded.
  await expect(page.locator('code', { hasText: 'default' }).first()).toBeVisible();

  // Edit the default kiosk's printer name.
  await page.getByRole('row', { name: /default/ }).getByRole('button', { name: 'Edit' }).click();
  await page.getByPlaceholder(/Brother QL-820NWB/).first().fill('Reception Printer');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Reception Printer' })).toBeVisible();

  // Add a second kiosk for the loading dock.
  await page.getByRole('button', { name: '+ Add kiosk' }).click();
  await page.getByLabel('Slug *').fill('loading-dock');
  await page.getByLabel('Display name *').fill('Loading dock');
  await page.getByLabel(/Default printer name/).fill('Dock Printer');
  await page.getByRole('button', { name: 'Create kiosk' }).click();
  await expect(page.getByRole('cell', { name: 'Loading dock' })).toBeVisible();
});

test('admin: visits Settings (notifications + branding panels render)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('AdminNewPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Email' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SMS' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();
});
