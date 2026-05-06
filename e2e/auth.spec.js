import { test, expect } from '@playwright/test';

test('bootstrap admin/admin → forced password change → topbar branding → sign out', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('admin');
  await page.getByRole('button', { name: /Sign in/ }).click();

  // Forced into change-password.
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await expect(page.getByText('You must change your password')).toBeVisible();

  await page.getByLabel('Current password').fill('admin');
  await page.getByLabel('New password').fill('NewAdmin1234');
  await page.getByLabel('Confirm new password').fill('NewAdmin1234');
  await page.getByRole('button', { name: 'Update password' }).click();

  // Lands on Users page (admin home); topbar shows visitas.world default brand.
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.locator('.brand-text')).toHaveText('visitas.world');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('kiosk is reachable without auth and renders the welcome form', async ({ page }) => {
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { name: 'Welcome.' })).toBeVisible();
  // Standard fields render from the schema.
  await expect(page.getByLabel(/Your name/)).toBeVisible();
  await expect(page.getByLabel(/Reason for visit/)).toBeVisible();
});

test('public wall view is reachable without auth', async ({ page }) => {
  await page.goto('/active');
  await expect(page.getByText('Currently on site')).toBeVisible();
});
