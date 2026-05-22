// req:scratchpad-mode, req:scratchpad-aggregation, req:scratchpad-auto-save-new
import { test } from "./fixtures";
import {
  mockGlobalApis,
  seedIndexedDB,
  seedLocalStorage,
  waitForEvent,
  ChatCompletionMocker,
  OPENROUTER_API_KEY,
  expect,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("Scratchpad: Basic Send Flow", () => {
  // req:scratchpad-auto-save-new — allow extra time for cold starts under parallel load
  test.setTimeout(60000);
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ page, context }) => {
    // Set up global API mocks and seed empty state
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        autoScrollEnabled: false,
        cachedModels: [],
        input: "",
        selectedPromptName: null,
      },
      version: 1,
    });
    await seedIndexedDB(context, {
      chat_sessions: [],
      system_prompts: [],
      snippets: [],
      scratchpad_sessions: [],
    });

    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // Navigate to scratchpad new — only initial page.goto is allowed
    await page.goto(ROUTES.scratchpad.new);
    // Use a generous timeout for app_initialized since cold starts can be slow under load
    await waitForEvent(page, "app_initialized", 15000);
    // Wait for the composer to be ready so the scratchpad saga has had time to settle
    await page.getByTestId("scratchpad-input").waitFor({ state: "visible" });
  });

  test("sends a message and URL transitions to a persistent scratchpad session", async ({ page }) => {
    // Purpose: Verifies req:scratchpad-auto-save-new — when the user types into scratchpad-input
    // and clicks scratchpad-send on /scratchpad/new, the request is streamed, the response
    // appears in scratchpad-response, and the URL changes from /scratchpad/new to
    // /scratchpad/<uuid> (req:scratchpad-mode, req:scratchpad-aggregation).

    // 1. Start on /scratchpad/new
    await expect(page).toHaveURL(/\/scratchpad\/new$/);

    // 2. Register mock for the streaming chat completion
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
      response: { role: "assistant", content: "Hello from scratchpad!" },
    });

    // 3. Type in the composer and submit
    await page.getByTestId("scratchpad-input").fill("hello");
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await page.getByTestId("scratchpad-send").click();
    await responsePromise;

    // 4. Wait for the response panel to appear with the mocked text
    await expect(page.getByTestId("scratchpad-response")).toBeVisible();
    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "Hello from scratchpad!",
    );

    // 5. URL must have changed from /scratchpad/new to /scratchpad/<uuid>
    await expect(page).not.toHaveURL(/\/scratchpad\/new$/);
    await expect(page).toHaveURL(/\/scratchpad\/[a-zA-Z0-9-_]+$/);

    // 6. The new URL segment must be a valid identifier (auto-saved session ID)
    const url = page.url();
    const match = url.match(/\/scratchpad\/([a-zA-Z0-9-_]+)$/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^[a-zA-Z0-9-_]+$/);

    chatMocker.verifyComplete();
  });
});
