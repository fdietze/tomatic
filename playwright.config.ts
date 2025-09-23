import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // testMatch: "**/snippets-editor.spec.ts",
  // testIgnore: "**/*snippet*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 8,
  reporter: [["list"], ["./pw-actions-reporter.cjs"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    // trace: 'retain-on-failure',
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            // Use with caution!
            // "--no-sandbox",
            // "--disable-setuid-sandbox",
            // "--disable-gl-drawing-for-tests",
          ],
        },
      },
    },
  ],
  timeout: 10 * 1000,
  expect: { timeout: 10_000 },
  webServer: {
    command: "VITE_IS_TESTING=true npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10 * 1000,
  },
});
