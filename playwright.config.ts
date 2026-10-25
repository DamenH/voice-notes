import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const fakeAudio = resolve('tests/fixtures/thinking-aloud-en.wav');
const chromiumArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fakeAudio}`, '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    permissions: ['microphone'],
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: chromiumArgs } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { args: chromiumArgs } } },
  ],
  webServer: {
    command: 'npx vite build --logLevel warn && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
