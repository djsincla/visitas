import { test, expect } from '@playwright/test';

// Visitor-perspective tests — public surfaces only, no auth.

test('visitor: opens kiosk, sees welcome with kiosk identity', async ({ page }) => {
  await page.goto('/kiosk/default');
  await expect(page.getByRole('heading', { name: 'Welcome.' })).toBeVisible();
  await expect(page.locator('.kiosk-loc')).toHaveText('Reception');
});

test('visitor: bare /kiosk redirects to /kiosk/default', async ({ page }) => {
  await page.goto('/kiosk');
  await expect(page).toHaveURL(/\/kiosk\/default/);
});

test('visitor: unknown kiosk slug shows a friendly error', async ({ page }) => {
  await page.goto('/kiosk/never-heard-of-it');
  await expect(page.getByRole('heading', { name: 'Unknown kiosk' })).toBeVisible();
});

test('visitor: signs in, gets thanked, badge URL is reachable', async ({ page, context }) => {
  // Block the print-window popup by intercepting window.open so we don't
  // leave a stray tab open in the test browser.
  await page.addInitScript(() => { window.open = () => null; });

  await page.goto('/kiosk/loading-dock');
  await expect(page.getByRole('heading', { name: 'Welcome.' })).toBeVisible();
  await expect(page.locator('.kiosk-loc')).toHaveText('Loading dock');

  // Empty submit → validation error.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.error')).toBeVisible();

  // Fill the form.
  await page.getByLabel(/Your name/).fill('Bob Visitor');
  await page.getByLabel(/Company/).fill('Test Co');
  await page.getByPlaceholder(/Type a name…/).fill('Jane');
  await page.getByRole('button', { name: 'Jane Host' }).click();
  await page.getByLabel(/Reason for visit/).selectOption('Meeting');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: /Thanks, Bob/ })).toBeVisible();
  await expect(page.getByText(/Jane Host/)).toBeVisible();
  await expect(page.getByText(/Dock Printer/)).toBeVisible();

  // The badge endpoint is reachable as standalone HTML for AirPrint.
  const badgePage = await context.newPage();
  const reprintLink = page.getByRole('link', { name: 'Reprint badge' });
  const href = await reprintLink.getAttribute('href');
  expect(href).toMatch(/\/api\/visits\/\d+\/badge/);
  const res = await badgePage.goto(href);
  expect(res?.ok()).toBe(true);
  await expect(badgePage.locator('text=Bob Visitor').first()).toBeVisible();
  await expect(badgePage.locator('text=Jane Host').first()).toBeVisible();
});

test('visitor: signs in at default, then signs out at /kiosk/signout', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });

  await page.goto('/kiosk/default');
  await page.getByLabel(/Your name/).fill('Going-Home Greta');
  await page.getByPlaceholder(/Type a name…/).fill('Jane');
  await page.getByRole('button', { name: 'Jane Host' }).click();
  await page.getByLabel(/Reason for visit/).selectOption('Meeting');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Thanks, Going-Home/ })).toBeVisible();

  // Wall view shows them on site.
  await page.goto('/active');
  await expect(page.getByText('Going-Home Greta')).toBeVisible();

  // Sign out at the kiosk.
  await page.goto('/kiosk/signout');
  await page.getByRole('button', { name: /Going-Home Greta/ }).click();
  await expect(page.getByRole('heading', { name: /Goodbye, Going-Home/ })).toBeVisible();

  // Wall view no longer shows them.
  await page.goto('/active');
  await expect(page.getByText('Going-Home Greta')).not.toBeVisible();
});
