import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './playwright-tests',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: 0,
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [ ['html', { open: 'never'}], ['list'] ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:8081',
    timezoneId: 'UTC',
    locale: 'en-US',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on',
  },

  timeout: 60000,

  expect: {
    toHaveScreenshot: {
      stylePath: './playwright-tests/screenshot.css',
      maxDiffPixels: 25,
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'seed',
      testMatch: /seed\.setup\.ts/,
    },
    {
      name: 'desktop',
      testMatch: /screens\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['seed'],
    },
    {
      name: 'phone',
      testMatch: /screens\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
      dependencies: ['seed'],
    },
    {
      name: 'onboarding-desktop',
      testMatch: /onboarding\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['seed'],
    },
    {
      name: 'onboarding-phone',
      testMatch: /onboarding\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
      dependencies: ['seed'],
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npx expo start',
    url: 'http://localhost:8081',
    reuseExistingServer: false,
    env: {
      DUO_STATUS_URL: 'http://localhost:8080',
      DUO_API_URL: 'http://localhost:5000',
      DUO_CHAT_URL: 'ws://localhost:5000/chat',
      DUO_IMAGES_URL: 'http://localhost:9090/s3-mock-bucket',
      DUO_AUDIO_URL: 'http://localhost:9090/s3-mock-audio-bucket',
    }
  },
});
