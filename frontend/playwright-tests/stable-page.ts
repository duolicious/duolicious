import { expect, Page } from '@playwright/test';

const prepare = async (
  page: Page,
  time: number,
  storage: Record<string, string> = {},
) => {
  await page.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.abort(),
  );

  await page.route((url) => url.pathname === '/stats', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...await response.json(), num_active_users: 1234 },
    });
  });

  await page.addInitScript((storage) => {
    const callCounts = new Map<string, number>();
    Math.random = () => {
      const site = (new Error().stack ?? '')
        .split('\n')
        .slice(2, 4)
        .map((frame) => frame.replace(/\S*:\d+:\d+\)?/g, '').trim())
        .join();
      const count = (callCounts.get(site) ?? 0) + 1;
      callCounts.set(site, count);

      let hash = 2166136261;
      for (const char of `${site}${count}`) {
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      }
      return (hash >>> 0) / 4294967296;
    };

    for (const [key, value] of Object.entries(storage)) {
      localStorage.setItem(key, value);
    }
  }, storage);

  await page.clock.install({ time });
};

const snap = async (page: Page, name: string) => {
  await page.mouse.move(0, 0);
  await page.clock.runFor(5000);

  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const steady = text
        .replace(/\b\d{1,2}:\d{2}\s?[ap]m\b/gi, '12:00 pm')
        .replace(/\bYesterday\b/g, 'Today')
        .replace(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, '1 Jan');
      if (steady !== text) {
        node.textContent = steady;
      }
    }
  });

  await expect.soft(page).toHaveScreenshot(`${name}.png`, {
    mask: [page.getByText(/@example\.com/)],
  });
};

export {
  prepare,
  snap,
};
