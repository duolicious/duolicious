import { test, expect } from '@playwright/test';

test('has correct invite flow for existing users who are logged out', async ({ page }) => {
  await page.route('**', async (route, request) => {
    const url = new URL(request.url());

    if (url.port === "8080") {
      await route.fulfill({
        json: {
          "api_version": 5,
          "supported_client_versions": [ 9, 10 ],
          "statuses": [ "ok", "down for maintenance" ],
          "status_index": 0,
        }
      });
    } else {
      await route.continue();
    }
  });

  await page.routeFromHAR(
    './playwright-hars/invite.existing-user.logged-out/invite.existing-user.logged-out.har',
    { update: false }
  );

  await page.goto('http://localhost:8081/invite/cool%20club');

  await expect(page.getByText('cool club')).toBeVisible();
  await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.01 });

  await page.getByText('Accept Invite').click();

  await expect(page.getByText('cool club')).toBeVisible();
  await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.01 });

  await page.getByPlaceholder('Enter your email to begin').click();
  await page.getByPlaceholder('Enter your email to begin').fill('user1@example.com');
  await page.locator('div').filter({ hasText: /^Sign Up or Sign In$/ }).nth(1).click();

  await page.locator('div:nth-child(2) > .css-view-175oi2r > input').first().fill('0');
  await page.locator('input:nth-child(2)').fill('0');
  await page.locator('input:nth-child(3)').fill('0');
  await page.locator('input:nth-child(4)').fill('0');
  await page.locator('input:nth-child(5)').fill('0');
  await page.locator('input:nth-child(6)').fill('0');
  await page.locator('div').filter({ hasText: /^Continue$/ }).nth(2).click();

  await expect(page.getByText('Everyone')).toBeVisible();
  await expect(page.getByText('cool club').last()).toBeVisible();
  await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.01 });

  await page.locator('button', { hasText: /Profile$/ }).last().click();
  await page.getByText('Sign Out').nth(1).click();
});
