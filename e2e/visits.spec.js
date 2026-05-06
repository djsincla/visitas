import { test, expect } from '@playwright/test';

async function adminLoggedIn(page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('admin');
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.getByLabel('Current password').fill('admin');
  await page.getByLabel('New password').fill('AAaa1234567');
  await page.getByLabel('Confirm new password').fill('AAaa1234567');
  await page.getByRole('button', { name: 'Update password' }).click();
}

test('kiosk → wall view → admin force sign-out', async ({ page, context }) => {
  // Set up: admin logged in, in a separate context for the kiosk surface.
  await adminLoggedIn(page);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  // The kiosk surface is reachable in this same browser; it's public.
  const kiosk = await context.newPage();
  await kiosk.goto('/kiosk');
  await expect(kiosk.getByRole('heading', { name: 'Welcome.' })).toBeVisible();

  // Fill the form. The bootstrap admin (Administrator) is the only host available out of the box.
  await kiosk.getByLabel(/Your name/).fill('Test Visitor');
  await kiosk.getByLabel(/Company/).fill('Test Co');

  // Host typeahead — type into the host input then click the suggestion.
  await kiosk.getByPlaceholder(/Type a name…/).fill('Adm');
  await kiosk.getByRole('button', { name: 'Administrator' }).click();

  // Reason for visit (select). Pick "Meeting".
  await kiosk.getByLabel(/Reason for visit/).selectOption('Meeting');

  await kiosk.getByRole('button', { name: 'Sign in' }).click();
  await expect(kiosk.getByRole('heading', { name: /Thanks, Test/ })).toBeVisible();

  // The public wall view shows the visitor.
  const wall = await context.newPage();
  await wall.goto('/active');
  await expect(wall.getByText('Test Visitor')).toBeVisible();
  await expect(wall.getByText('visiting Administrator')).toBeVisible();

  // Admin force-signs them out.
  await page.goto('/admin/active-visitors');
  await expect(page.getByRole('heading', { name: 'Active visitors' })).toBeVisible();
  await expect(page.getByText('Test Visitor')).toBeVisible();
  await page.getByRole('button', { name: 'Force sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();

  // After refresh the visitor is gone from the active list.
  await expect(page.getByText('Test Visitor')).not.toBeVisible();
});

test('security user can force sign-out but cannot reach admin-only pages', async ({ page, context }) => {
  // Bootstrap as admin and create a security user.
  await adminLoggedIn(page);
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: '+ Add user' }).click();
  await page.getByLabel(/Role/).selectOption('security');
  await page.getByLabel(/Username/).fill('guard');
  await page.getByLabel(/Initial password/).fill('GuardPass1234');
  await page.getByRole('button', { name: 'Create user' }).click();

  // Create a visit through the kiosk.
  const kiosk = await context.newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByLabel(/Your name/).fill('Walk-In');
  await kiosk.getByPlaceholder(/Type a name…/).fill('Adm');
  await kiosk.getByRole('button', { name: 'Administrator' }).click();
  await kiosk.getByLabel(/Reason for visit/).selectOption('Meeting');
  await kiosk.getByRole('button', { name: 'Sign in' }).click();
  await expect(kiosk.getByRole('heading', { name: /Thanks/ })).toBeVisible();

  // Sign out as admin, log in as security.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Username').fill('guard');
  await page.getByLabel('Password').fill('GuardPass1234');
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.getByLabel('Current password').fill('GuardPass1234');
  await page.getByLabel('New password').fill('NewGuard12345');
  await page.getByLabel('Confirm new password').fill('NewGuard12345');
  await page.getByRole('button', { name: 'Update password' }).click();

  // Lands on Active visitors. Topbar should NOT include Users / Settings.
  await expect(page.getByRole('heading', { name: 'Active visitors' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);

  // Force sign-out works for security too.
  await expect(page.getByText('Walk-In')).toBeVisible();
  await page.getByRole('button', { name: 'Force sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();
  await expect(page.getByText('Walk-In')).not.toBeVisible();
});
