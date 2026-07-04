import { test, expect } from '@playwright/test';

test.use({ storageState: './playwright-fixtures/state.json' });

test('has correct invite flow for existing users who are logged in', async ({ page }) => {
  await page.route('**', async (route, request) => {
    const url = new URL(request.url());

    if (url.port === "8080") {
      await route.fulfill({
        json: {
          "api_version": 9,
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
    './playwright-hars/invite.existing-user.logged-in/invite.existing-user.logged-in.har',
    { update: false }
  );

  await page.goto('http://localhost:8081/invite/cool%20club');

  await expect(page.getByText('cool club')).toBeVisible();
  await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.01 });

  await page.getByText('Accept Invite').click();

  await expect(page.getByText('Everyone')).toBeVisible();
  await expect(page.getByText('cool club').last()).toBeVisible();
  await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.01 });

  await page.locator('button', { hasText: /Profile$/ }).last().click();
  await page.getByText('Sign Out').nth(1).click();
});
