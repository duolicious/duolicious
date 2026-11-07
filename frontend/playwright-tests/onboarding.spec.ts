import { test, expect, Page } from '@playwright/test';
import { prepare, snap } from './stable-page';

const SIGN_UP_TIME = Date.UTC(2026, 5, 1, 12);

const visibleText = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).filter({ visible: true }).last();

const tap = (page: Page, text: string) => visibleText(page, text).click();

const leave = (page: Page, title: string) =>
  expect(page.getByText(title, { exact: true })).toBeHidden();

const requestCode = async (page: Page) => {
  await tap(page, 'Use email');
  await leave(page, 'Use email');
  await page.getByPlaceholder('you@example.com').fill(`${Date.now()}@example.com`);
  await tap(page, 'Continue');
};

const signUp = async (
  page: Page,
  step: (name: string) => Promise<void> = async () => {},
) => {
  await requestCode(page);

  const otp = page.locator('input[inputmode="numeric"]').first();
  await expect(otp).toBeVisible();
  await expect(async () => {
    await page.clock.fastForward(1000);
    await expect(visibleText(page, 'Resend password')).toBeVisible({ timeout: 50 });
  }).toPass({ intervals: [50] });
  await step('one-time-password');
  await otp.fill('000000');
  await leave(page, 'Password');
  await step('display-name');

  await page.getByPlaceholder('First name').fill('Test');
  await tap(page, 'Continue');
  await leave(page, 'Step 1 of 5: Display Name');
  await step('gender');

  await tap(page, 'Woman');
  await tap(page, 'Continue');
  await leave(page, 'Step 2 of 5: Your Gender');
  await step('partners-gender');

  await tap(page, 'Man');
  await tap(page, 'Continue');
  await leave(page, 'Step 3 of 5: Your Partner’s Gender');
  await step('birth-date');

  await tap(page, 'Day');
  await tap(page, '1');
  await tap(page, 'Month');
  await tap(page, 'Jan');
  await tap(page, 'Year');
  await tap(page, '2000');
  await tap(page, 'Continue');
  await expect(visibleText(page, 'Yes, I’m 26')).toBeVisible();
  await step('age-confirmation');
  await tap(page, 'Yes, I’m 26');
  await leave(page, 'Step 4 of 5: Birth Date');
  await step('location');

  await tap(page, 'Manually enter my location');
  await page.getByPlaceholder('Type a location...').fill('Paris');
  await tap(page, 'Paris, Île-de-France, France');
  await tap(page, 'Continue');
  await leave(page, 'Step 5 of 5: Location');
  await step('complete-sign-up');

  await tap(page, 'Complete Sign Up');
  await leave(page, 'You’re Looking Like A Snack 😋');
};

test('new users can sign up', async ({ page }) => {
  await prepare(page, SIGN_UP_TIME);
  await page.goto('/');
  await tap(page, 'Join or sign in');
  await signUp(page, (name) => snap(page, name));

  await tap(page, 'Profile');
  await expect(page.getByText('Test', { exact: true })).toBeVisible();
});

test('new users can accept club invites', async ({ page }) => {
  const clubName = `invite ${Date.now()}`;

  await prepare(page, SIGN_UP_TIME);
  await page.goto(`/invite/${encodeURIComponent(clubName)}`);
  await tap(page, 'Accept Invite');
  await signUp(page);

  await expect(visibleText(page, 'Everyone')).toBeVisible();
  await expect(visibleText(page, clubName)).toBeVisible();
});

test('mistyped one-time passwords can be corrected', async ({ page }) => {
  const sentCodes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/check-otp')) {
      sentCodes.push(request.postDataJSON().otp);
    }
  });

  await prepare(page, SIGN_UP_TIME);
  await page.goto('/');
  await tap(page, 'Join or sign in');
  await requestCode(page);

  const boxes = page.locator('input[inputmode="numeric"]');
  const typedCode = () => boxes.evaluateAll(
    (inputs: HTMLInputElement[]) => inputs.map((input) => input.value).join(''));

  await expect(boxes.first()).toBeFocused();
  await page.keyboard.type('12345');
  await boxes.first().click();
  await page.keyboard.type('0');
  await expect.poll(typedCode).toBe('02345');

  await page.keyboard.type('6');
  await expect(page.getByText('Incorrect code. Try Again.')).toHaveCSS('opacity', '1');
  await expect.poll(typedCode).toBe('');
  await expect(boxes.first()).toBeFocused();

  await page.keyboard.type('000000');
  await leave(page, 'Password');
  expect(sentCodes).toEqual(['023456', '000000']);
});
