import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a real backend in Mock mode (no network, the same cabinets
 * "streaming" every run) and a Vite server of their own, on ports that stay clear of a
 * running dev setup (5180 / 5173).
 *
 * WebKit is not optional here: most of what broke in the desktop shell - a stale logo,
 * YouTube's outdated-browser page, media paused off screen - broke only in WebKit.
 */
const API = 'http://localhost:5190';
const WEB = 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      // DOTNET points at a specific SDK when the one on PATH is too old (it must be .NET 10).
      command: `${process.env.DOTNET ?? 'dotnet'} run --project ../backend/TaikoLabs.Api --no-launch-profile --urls ${API}`,
      url: `${API}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        YouTube__Mode: 'Mock',
        // No key, so nothing reaches YouTube - not even the channel avatar lookup.
        YouTube__ApiKey: '',
        Venues__ClosureCachePath: '/tmp/taiko-e2e-closures.json',
      },
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: WEB,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: { TAIKO_API_PROXY: API },
    },
  ],
});
