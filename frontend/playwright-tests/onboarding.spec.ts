import { test } from '@playwright/test';

test('has correct onboarding flow', async ({ page }) => {
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
    './playwright-hars/onboarding/onboarding.har',
    { update: false }
  );

  await page.goto('http://localhost:8081');

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

  await page.getByPlaceholder('First name').fill('Test');
  await page.getByText('Continue').nth(1).click();

  await page.getByText('Woman', { exact: true }).click();
  await page.getByText('Continue').nth(2).click();

  await page.getByText('Man', { exact: true }).nth(1).click();
  await page.getByText('Other').nth(1).click();
  await page.getByText('Continue').nth(3).click();

  await page.getByText('Day').click();
  await page.getByText('1', { exact: true }).click();
  await page.locator('img').nth(1).click();
  await page.getByText('Jan').click();
  await page.locator('img').nth(2).click();
  await page.getByText('2004').click();
  await page.getByText('Continue').nth(4).click();

  await page.getByPlaceholder('Type a location...').click();
  await page.getByPlaceholder('Type a location...').fill('Paris');
  await page.getByText('Paris, Île-de-France, France').click();

  await page.getByText('Continue').nth(5).click();

  await page.getByText('Continue').nth(6).click();

  await page.locator('button', { hasText: /Profile$/ }).last().click();
  await page.getByText('Sign Out').nth(1).click();
});
