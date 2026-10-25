import { test as base, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { SEED_FILE, Seed, api, signIn, viewer } from './backend';
import { prepare, snap } from './stable-page';

const readSeed = (): Seed => JSON.parse(readFileSync(SEED_FILE, 'utf8'));

const SIGNED_IN_CLOCK_OFFSET_MS = 2 * 60 * 60 * 1000;

const test = base.extend({
  timezoneId: async ({}, provide) => {
    const midway = new Date(readSeed().time + SIGNED_IN_CLOCK_OFFSET_MS / 2);
    const offset = Math.round(12 - midway.getUTCHours() - midway.getUTCMinutes() / 60);
    await provide(`Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`);
  },
});

const shown = (page: Page, text: string) =>
  expect(page.getByText(text).filter({ visible: true }).first()).toBeVisible();

const tap = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).filter({ visible: true }).last().click();

const visit = async (page: Page, path: string, readyText: string, name: string) => {
  await page.goto(path);
  await shown(page, readyText);
  await snap(page, name);
};

const signInPage = async (page: Page, seed: Seed, theme: string) => {
  const session = await signIn(viewer.email);
  const seen = JSON.stringify([session.uuid]);

  await prepare(page, seed.time + SIGNED_IN_CLOCK_OFFSET_MS, {
    session_token: session.token,
    person_uuid: session.uuid,
    app_theme_name: theme,
    web_session_bridge_answered: '1',
    seen_search_filters_hint: seen,
    seen_inbox_filter_hint: seen,
    seen_reply_hint: seen,
  });

  return session;
};

test('signed-out screens', async ({ page }) => {
  await prepare(page, readSeed().time);

  await visit(page, '/', 'Join or sign in', 'signed-out-search');

  await tap(page, 'Join or sign in');
  await shown(page, 'Use email');
  await snap(page, 'join-or-sign-in');

  await visit(page, '/email', 'Continue with email', 'email');
  await visit(page, '/invite/snapshot%20club', 'Accept Invite', 'invite');
});

for (const theme of ['light', 'dark']) {
  test(`signed-in screens in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(240_000);

    const seed = readSeed();
    const blake = seed.uuids.blake;

    await signInPage(page, seed, theme);

    await visit(page, '/qa', 'Answer Publicly', `${theme}-qa`);
    await visit(page, '/search', 'Blake, 26', `${theme}-search`);
    await visit(page, '/search/filters', 'Other Basics', `${theme}-search-filters`);
    await visit(page, '/search/filters/qa', 'added any Q&A filters', `${theme}-qa-filters`);
    await visit(page, '/search/filters/two-way', 'Making a filter two-way', `${theme}-two-way-filters`);

    await expect(async () => {
      await page.goto('/feed');
      for (const name of ['Cameron', 'Blake', 'Dakota']) {
        await expect(page.getByText(name, { exact: true }).first()).toBeAttached();
      }
    }).toPass({ timeout: 120_000 });
    await snap(page, `${theme}-feed`);

    await visit(page, '/inbox', 'I saw you like hiking', `${theme}-inbox-intros`);
    await tap(page, 'Chats');
    await shown(page, 'Definitely sourdough');
    await snap(page, `${theme}-inbox-chats`);

    await visit(page, `/chat/${seed.uuids.emery}`, 'Definitely sourdough', `${theme}-conversation`);

    await visit(page, `/${blake}`, 'Engineer', `${theme}-prospect-profile`);
    await page.locator('a[href^="/gallery/"]').filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/gallery\//);
    await snap(page, `${theme}-gallery`);

    await visit(page, `/in-depth/${blake}`, 'Q&A Answers', `${theme}-in-depth`);
    await tap(page, 'Personality');
    await snap(page, `${theme}-in-depth-personality`);

    await visit(page, '/visitors', 'Dakota', `${theme}-visitors`);
    await tap(page, 'You Visited');
    await shown(page, 'Blake');
    await snap(page, `${theme}-you-visited`);

    await visit(page, '/profile', 'Verification', `${theme}-profile`);
    await tap(page, 'Get Verified');
    await shown(page, 'By continuing, you agree');
    await snap(page, `${theme}-get-verified`);
  });
}

test('back button anchored to the profile photo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');

  const seed = readSeed();
  await signInPage(page, seed, 'light');

  await page.setViewportSize({ width: 1050, height: 720 });
  await visit(page, `/${seed.uuids.blake}`, 'Engineer', 'prospect-profile-1050px');

  for (const width of [990, 900, 500]) {
    await page.setViewportSize({ width, height: 720 });
    await snap(page, `prospect-profile-${width}px`);
  }
});

for (const theme of ['light', 'dark']) {
  test(`skipping someone in the ${theme} theme`, async ({ page }, testInfo) => {
    const seed = readSeed();
    const session = await signInPage(page, seed, theme);
    const chat = `/chat/${seed.uuids.emery}`;
    const hasInboxPanel = testInfo.project.name === 'desktop';

    try {
      await page.goto(chat);
      await shown(page, 'Definitely sourdough');
      await tap(page, '\uf2d4');
      await tap(page, 'Skip');
      if (hasInboxPanel) {
        await shown(page, 'You skipped Emery');
        await snap(page, `${theme}-skipped`);
      }

      await visit(page, chat, 'so you can’t message each other', `${theme}-skipped-conversation`);
      await tap(page, 'Undo skip');
      await expect(page.getByText('so you can’t message each other')).toBeHidden();

      if (!hasInboxPanel) return;

      await page.route('**/skip/by-uuid/**', (route) => route.fulfill({ body: '' }));
      await tap(page, '\uf2d4');
      await tap(page, 'Report');
      await page.getByPlaceholder('Write here...').filter({ visible: true }).fill('Kept messaging after I said no thanks.');
      await tap(page, 'Submit');
      await shown(page, 'You reported Emery');
      await snap(page, `${theme}-reported`);
    } finally {
      await api('POST', `/unskip/by-uuid/${seed.uuids.emery}`, session);
    }
  });
}
