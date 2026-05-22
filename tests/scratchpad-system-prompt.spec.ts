// req:scratchpad-auto-save-new, req:scratchpad-staleness
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
import type { DBV3_SystemPrompt } from "../src/types/storage";

const SYSTEM_PROMPTS: DBV3_SystemPrompt[] = [
  { name: "concise", prompt: "Be concise." },
  { name: "verbose", prompt: "Be very verbose." },
];

test.describe("Scratchpad: System Prompt", () => {
  // req:scratchpad-auto-save-new, req:scratchpad-staleness — allow extra time for cold starts
  test.setTimeout(60000);
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    // Seed two system prompts and zero scratchpad sessions, then navigate to /scratchpad/new
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
      system_prompts: SYSTEM_PROMPTS,
      snippets: [],
      scratchpad_sessions: [],
    });

    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // Initial navigation — only page.goto allowed here
    await page.goto(ROUTES.scratchpad.new);
    // Use a generous timeout for app_initialized since cold starts can be slow under load
    await waitForEvent(page, "app_initialized", 15000);
    // Wait for the composer to be ready so the scratchpad saga has had time to settle
    await page.getByTestId("scratchpad-input").waitFor({ state: "visible" });
  });

  test("first send autosaves the session and URL changes from /scratchpad/new", async ({ page }) => {
    // Purpose: Verifies req:scratchpad-auto-save-new — on /scratchpad/new with system prompts
    // available, the user types a message and submits; the session is auto-saved and the URL
    // transitions to /scratchpad/<uuid>, confirming persistence works with system prompts seeded.

    // 1. Verify we start on /scratchpad/new
    await expect(page).toHaveURL(/\/scratchpad\/new$/);

    // 2. Verify both system prompt buttons are visible
    await expect(
      page.getByTestId("system-prompt-button-concise"),
    ).toBeVisible();
    await expect(
      page.getByTestId("system-prompt-button-verbose"),
    ).toBeVisible();

    // 3. Register a mock for a plain user message (no system prompt selected)
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: "test input" }],
        stream: true,
      },
      response: { role: "assistant", content: "auto-saved response" },
    });

    // 4. Type and send
    await page.getByTestId("scratchpad-input").fill("test input");
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await page.getByTestId("scratchpad-send").click();
    await responsePromise;

    // 5. Response must appear
    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "auto-saved response",
    );

    // 6. URL must have changed from /scratchpad/new to /scratchpad/<uuid>
    await expect(page).not.toHaveURL(/\/scratchpad\/new$/);
    await expect(page).toHaveURL(/\/scratchpad\/[a-zA-Z0-9-_]+$/);

    chatMocker.verifyComplete();
  });

  test("selecting a different system prompt after receiving a response marks it stale", async ({ page }) => {
    // Purpose: Verifies req:scratchpad-staleness — after sending a message and getting a
    // response, switching to a different system prompt (or selecting one for the first time)
    // marks the response stale. No API call is made; the stale badge appears immediately.

    // 1. Select "concise" system prompt before sending
    await page.getByTestId("system-prompt-button-concise").click();

    // 2. Send a message with the concise system prompt selected
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "question" },
        ],
        stream: true,
      },
      response: { role: "assistant", content: "short answer" },
    });

    await page.getByTestId("scratchpad-input").fill("question");
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await page.getByTestId("scratchpad-send").click();
    await responsePromise;

    // 3. Verify response received and no stale badge yet.
    // Wait for the regenerate button to be enabled — that confirms responseDone has been
    // dispatched (submitting=false), so is_stale is settled at false before we change the prompt.
    await expect(page.getByTestId("scratchpad-regenerate")).toBeEnabled();
    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "short answer",
    );
    await expect(page.getByTestId("scratchpad-stale-badge")).not.toBeVisible();

    // 4. Switch to "verbose" system prompt — this should mark the response stale
    await page.getByTestId("system-prompt-button-verbose").click();

    // 5. Stale badge must now be visible; no additional API call was made
    await expect(page.getByTestId("scratchpad-stale-badge")).toBeVisible();

    // 6. Response content is unchanged
    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "short answer",
    );

    chatMocker.verifyComplete();
  });
});
