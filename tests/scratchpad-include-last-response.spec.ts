// req:scratchpad-include-last-response, req:scratchpad-include-last-response-shape,
// req:scratchpad-include-last-response-stale, req:scratchpad-include-last-response-persisted
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
import type { ScratchpadSession } from "@/types/scratchpad";

const MODEL = "google/gemini-2.5-pro";

const sessionWithPrior = (id: string, includeLast: boolean): ScratchpadSession => ({
  session_id: id,
  inputs: [
    { id: "i1", raw_content: "A", resolved_content: "A" },
    { id: "i2", raw_content: "B", resolved_content: "B" },
  ],
  response: {
    content: "PRIOR",
    model_name: MODEL,
    cost: null,
    error: null,
    is_stale: false,
  },
  created_at_ms: 1,
  updated_at_ms: 2,
  include_last_response: includeLast,
});

test.describe("Scratchpad: include last response in context", () => {
  test.setTimeout(60000);
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: MODEL,
        autoScrollEnabled: false,
        cachedModels: [],
        input: "",
        selectedPromptName: null,
      },
      version: 1,
    });
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test("sends a 4-message multi-turn payload when the flag is on and prior response is usable", async ({
    context,
    page,
  }) => {
    // Purpose: req:scratchpad-include-last-response-shape — verifies that when the per-session
    // checkbox is on and a usable prior response exists, the outgoing request is
    // [user(earlier inputs joined), assistant(last response), user(new input)] rather than
    // a single aggregated user message. Asserted via strict request matching on the mock.
    await seedIndexedDB(context, {
      chat_sessions: [],
      system_prompts: [],
      snippets: [],
      scratchpad_sessions: [sessionWithPrior("s-multi", true)],
    });

    await page.goto(ROUTES.scratchpad.session("s-multi"));
    await waitForEvent(page, "app_initialized", 15000);
    await page.getByTestId("scratchpad-input").waitFor({ state: "visible" });

    // Checkbox reflects the persisted flag.
    await expect(
      page.getByTestId("scratchpad-include-last-response"),
    ).toBeChecked();

    // Strict mock for the 4-message multi-turn shape.
    chatMocker.mock({
      request: {
        model: MODEL,
        messages: [
          { role: "user", content: "A\n\nB" },
          { role: "assistant", content: "PRIOR" },
          { role: "user", content: "NEW" },
        ],
        stream: true,
      },
      response: { role: "assistant", content: "refined output" },
    });

    await page.getByTestId("scratchpad-input").fill("NEW");
    const respPromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await page.getByTestId("scratchpad-send").click();
    await respPromise;

    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "refined output",
    );
    chatMocker.verifyComplete();
  });

  test("falls back to single-user-message shape when the flag is off (default)", async ({
    context,
    page,
  }) => {
    // Purpose: req:scratchpad-mode default behavior is preserved when the checkbox is off:
    // all inputs collapsed into one user message; no assistant turn from the prior response.
    await seedIndexedDB(context, {
      chat_sessions: [],
      system_prompts: [],
      snippets: [],
      scratchpad_sessions: [sessionWithPrior("s-single", false)],
    });

    await page.goto(ROUTES.scratchpad.session("s-single"));
    await waitForEvent(page, "app_initialized", 15000);
    await page.getByTestId("scratchpad-input").waitFor({ state: "visible" });

    await expect(
      page.getByTestId("scratchpad-include-last-response"),
    ).not.toBeChecked();

    chatMocker.mock({
      request: {
        model: MODEL,
        messages: [{ role: "user", content: "A\n\nB\n\nNEW" }],
        stream: true,
      },
      response: { role: "assistant", content: "single-shape ok" },
    });

    await page.getByTestId("scratchpad-input").fill("NEW");
    const respPromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await page.getByTestId("scratchpad-send").click();
    await respPromise;

    await expect(page.getByTestId("scratchpad-response")).toContainText(
      "single-shape ok",
    );
    chatMocker.verifyComplete();
  });

  test("toggling the checkbox marks the current response stale without regenerating", async ({
    context,
    page,
  }) => {
    // Purpose: req:scratchpad-include-last-response-stale — toggling marks stale (same pattern
    // as model / system prompt change); no network call is issued.
    await seedIndexedDB(context, {
      chat_sessions: [],
      system_prompts: [],
      snippets: [],
      scratchpad_sessions: [sessionWithPrior("s-stale", false)],
    });

    await page.goto(ROUTES.scratchpad.session("s-stale"));
    await waitForEvent(page, "app_initialized", 15000);
    await page.getByTestId("scratchpad-input").waitFor({ state: "visible" });

    // Response is non-stale before toggling.
    await expect(page.getByTestId("scratchpad-regenerate")).toBeEnabled();
    await expect(page.getByTestId("scratchpad-response")).toContainText("PRIOR");
    await expect(page.getByTestId("scratchpad-stale-badge")).not.toBeVisible();

    await page.getByTestId("scratchpad-include-last-response").check();

    await expect(page.getByTestId("scratchpad-stale-badge")).toBeVisible();
    // Content unchanged — no regeneration triggered.
    await expect(page.getByTestId("scratchpad-response")).toContainText("PRIOR");
    chatMocker.verifyComplete();
  });
});
