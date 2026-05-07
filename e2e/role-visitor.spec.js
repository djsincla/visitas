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

test('visitor: full flow form → safety → NDA + signature → thanks → badge', async ({ page, context }) => {
  // Block the print-window popup so we don't leave a stray tab in tests.
  await page.addInitScript(() => { window.open = () => null; });

  await page.goto('/kiosk/loading-dock');
  await expect(page.getByRole('heading', { name: 'Welcome.' })).toBeVisible();
  await expect(page.locator('.kiosk-loc')).toHaveText('Loading dock');

  // Empty submit → validation error.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.error')).toBeVisible();

  // Fill the form.
  await page.getByLabel(/Your name/).fill('Bob Visitor');
  await page.getByLabel(/Company/).fill('Test Co');
  await page.getByLabel(/Email/).fill('bob@example.com');
  await page.getByPlaceholder(/Type a name…/).fill('Jane');
  await page.getByRole('button', { name: 'Jane Host' }).click();
  await page.getByLabel(/Reason for visit/).selectOption('Meeting');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Safety screen — scroll to bottom to enable.
  await expect(page.getByRole('heading', { name: /Workshop safety/i })).toBeVisible();
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: /I have read this/ }).click();

  // NDA screen — scroll + sign + confirm.
  await expect(page.getByRole('heading', { name: /Visitor non-disclosure/i })).toBeVisible();
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  // Draw a stroke on the signature pad.
  const pad = page.locator('canvas.signature-pad');
  const padBox = await pad.boundingBox();
  await page.mouse.move(padBox.x + 20, padBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(padBox.x + 200, padBox.y + 100, { steps: 10 });
  await page.mouse.up();

  await page.getByRole('button', { name: /I agree and sign/ }).click();

  await expect(page.getByRole('heading', { name: /Thanks, Bob/ })).toBeVisible();
  await expect(page.getByText(/Jane Host/)).toBeVisible();
  await expect(page.getByText(/Dock Printer/)).toBeVisible();
  await expect(page.getByText(/copy of the signed NDA has been emailed/)).toBeVisible();

  // Badge endpoint reachable.
  const badgePage = await context.newPage();
  const href = await page.getByRole('link', { name: 'Reprint badge' }).getAttribute('href');
  expect(href).toMatch(/\/api\/visits\/\d+\/badge/);
  const res = await badgePage.goto(href);
  expect(res?.ok()).toBe(true);
  await expect(badgePage.locator('text=Bob Visitor').first()).toBeVisible();
});

test('visitor: signs in (with safety + NDA) then signs out at /kiosk/signout', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });

  await page.goto('/kiosk/default');
  await page.getByLabel(/Your name/).fill('Going-Home Greta');
  await page.getByPlaceholder(/Type a name…/).fill('Jane');
  await page.getByRole('button', { name: 'Jane Host' }).click();
  await page.getByLabel(/Reason for visit/).selectOption('Meeting');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Safety
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: /I have read this/ }).click();

  // NDA
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  const pad = page.locator('canvas.signature-pad');
  const padBox = await pad.boundingBox();
  await page.mouse.move(padBox.x + 20, padBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(padBox.x + 200, padBox.y + 100, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: /I agree and sign/ }).click();

  await expect(page.getByRole('heading', { name: /Thanks, Going-Home/ })).toBeVisible();

  // Wall view shows them on site.
  await page.goto('/active');
  await expect(page.getByText('Going-Home Greta')).toBeVisible();

  // Sign out at the kiosk.
  await page.goto('/kiosk/signout');
  await page.getByRole('button', { name: /Going-Home Greta/ }).click();
  await expect(page.getByRole('heading', { name: /Goodbye, Going-Home/ })).toBeVisible();

  await page.goto('/active');
  await expect(page.getByText('Going-Home Greta')).not.toBeVisible();
});
