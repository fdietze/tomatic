import { chromium, type FullConfig } from "@playwright/test";

// Pre-warm vite's dev compile cache by hitting routes used by tests
// before the parallel workers all stampede the server simultaneously.
export default async function globalSetup(_config: FullConfig) {
  const baseURL = "http://127.0.0.1:5173";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/chat/new`, { timeout: 180_000, waitUntil: "domcontentloaded" });
  await browser.close();
}
