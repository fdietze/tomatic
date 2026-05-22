// req:scratchpad-staleness
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
import type { ScratchpadSession } from "../src/types/scratchpad";

const SEEDED_SESSION: ScratchpadSession = {
  session_id: "pre",
  prompt_name: null,
  inputs: [
    {
      id: "c1",
      raw_content: "first",
      resolved_content: "first",
    },
  ],
  response: {
    content: "old response",
    model_name: "google/gemini-2.5-pro",
    cost: null,
    error: null,
    is_stale: false,
  },
  created_at_ms: 1000,
  updated_at_ms: 1000,
};

test.describe("Scratchpad: Staleness", () => {
  // req:scratchpad-staleness — allow extra time for cold starts under parallel load
  test.setTimeout(60000);

  test.beforeEach(async ({ context, page }) => {
    // Set up global API mocks and seed the pre-existing scratchpad session
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
      scratchpad_sessions: [SEEDED_SESSION],
    });

    // Navigate directly to the seeded session (initial page.goto is allowed)
    await page.goto(ROUTES.scratchpad.session("pre"));
    // Use a generous timeout for app_initialized since cold starts can be slow under load
    await waitForEvent(page, "app_initialized", 15000);
    // Wait for the composer to be ready so the loadSession saga has fully settled
    await page.getByTestId("scratchpad-input").waitFor({ state: "visible" });

    // Confirm the session is loaded and the response is visible before each test
    await expect(page.getByTestId("scratchpad-chunk-c1")).toBeVisible();
    await expect(page.getByTestId("scratchpad-response")).toBeVisible();
  });

  test("editing a chunk marks the response stale without regenerating", async ({ page }) => {
    // Purpose: Verifies req:scratchpad-staleness — when the user clicks edit on chunk c1,
    // modifies its text, and saves, the stale badge appears on the response panel but the
    // response content itself does not change (no API call is made).

    // 1. Verify no stale badge initially
    await expect(page.getByTestId("scratchpad-stale-badge")).not.toBeVisible();

    // 2. Enter edit mode for chunk c1
    await page.getByTestId("scratchpad-chunk-edit-c1").click();

    // 3. Change the text and save
    await page.getByTestId("scratchpad-chunk-textarea-c1").fill("modified text");
    await page.getByTestId("scratchpad-chunk-save-c1").click();

    // 4. Stale badge must now be visible
    await expect(page.getByTestId("scratchpad-stale-badge")).toBeVisible();

    // 5. Response content must be unchanged (no API call was made)
    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "old response",
    );
  });

  test("deleting a chunk marks the response stale", async ({ page }) => {
    // Purpose: Verifies req:scratchpad-staleness — deleting the only input chunk marks the
    // response stale. The response panel remains visible (submitting=false, response!=null)
    // and the stale badge is shown.

    // 1. Verify no stale badge initially
    await expect(page.getByTestId("scratchpad-stale-badge")).not.toBeVisible();

    // 2. Delete chunk c1
    await page.getByTestId("scratchpad-chunk-delete-c1").click();

    // 3. The response panel should still be visible (response is in state, not cleared on delete)
    await expect(page.getByTestId("scratchpad-response")).toBeVisible();

    // 4. Stale badge must now be visible
    await expect(page.getByTestId("scratchpad-stale-badge")).toBeVisible();
  });

  test("editing a chunk and clicking regenerate updates the response and hides stale badge", async ({ page }) => {
    // Purpose: Verifies req:scratchpad-staleness — after an edit marks the response stale,
    // clicking regenerate triggers a new API call, the stale badge disappears, and the
    // response content is updated to the fresh mocked text.

    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // 1. Edit chunk c1 to produce a stale response
    await page.getByTestId("scratchpad-chunk-edit-c1").click();
    await page.getByTestId("scratchpad-chunk-textarea-c1").fill("updated text");
    await page.getByTestId("scratchpad-chunk-save-c1").click();

    // Stale badge should be visible before regenerate
    await expect(page.getByTestId("scratchpad-stale-badge")).toBeVisible();

    // 2. Register mock — the regenerate worker re-resolves all inputs, so
    // "updated text" becomes the user message content.
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: "updated text" }],
        stream: true,
      },
      response: { role: "assistant", content: "fresh response" },
    });

    // 3. Click regenerate
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await page.getByTestId("scratchpad-regenerate").click();
    await responsePromise;

    // 4. Stale badge must be gone and response updated
    await expect(page.getByTestId("scratchpad-stale-badge")).not.toBeVisible();
    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "fresh response",
    );

    chatMocker.verifyComplete();
  });
});
