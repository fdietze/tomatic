import { ROUTES } from "@/utils/routes";
import { test } from "./fixtures";
import { SettingsPage } from "./pom/SettingsPage";
import {
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
  ChatCompletionMocker,
  seedIndexedDB,
  waitForEvent,
} from "./test-helpers";

test.describe("Automatic Regeneration Edge Cases", () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page, expectedConsoleErrors }) => {
    expectedConsoleErrors.push(/Internal Server Error/, /Generation failed/);
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        autoScrollEnabled: false,
      },
      version: 1,
    });
    settingsPage = new SettingsPage(page);
  });

  test.describe("when an update introduces a cycle", () => {
    test.beforeEach(async ({ context, page }) => {
      await seedIndexedDB(context, {
        snippets: [
          { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          { id: "b", name: "B", content: "Content of B from v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false },
          { id: "c", name: "C", content: "Content of C from B_v1", isGenerated: true, prompt: "Prompt for C using @B", model: "mock-model/mock-model", createdAt_ms: 2, updatedAt_ms: 2, generationError: null, isDirty: false },
        ],
      });
      await page.goto(ROUTES.settings);
    });

    test("halts regeneration", async ({
      expectedConsoleErrors,
    }) => {
      // Purpose: This test ensures that if updating a snippet introduces a dependency cycle,
      // the automatic regeneration process is halted to prevent an infinite loop. The existing
      // content of the dependent snippets should remain unchanged.
      expectedConsoleErrors.push(
        /\[validateSnippetDependencies\] Cycle detected/,
      );
      
      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Content of B from v1/,
      );
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v1/,
      );
      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "v2 referencing @C");
      await settingsPage.saveSnippet();
      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Content of B from v1/,
      );
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v1/,
      );
    });
  });

  test.describe("when a dependency fails to regenerate", () => {
    test("propagates failures transitively", async ({
      page,
      context,
      expectedConsoleErrors,
    }) => {
      // Purpose: This test verifies that if a snippet in a dependency chain fails to
      // regenerate, the failure is propagated to all downstream snippets.
      expectedConsoleErrors.push(/Failed to load resource.*500/);
      const chatMocker = new ChatCompletionMocker(page);
      await chatMocker.setup();

      await seedIndexedDB(context, {
        snippets: [
          { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          { id: "b", name: "B", content: "Content of B from v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false },
          { id: "c", name: "C", content: "Content of C from B_v1", isGenerated: true, prompt: "Prompt for C using @B", model: "mock-model/mock-model", createdAt_ms: 2, updatedAt_ms: 2, generationError: null, isDirty: false },
        ],
      });

      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Prompt for B using v2" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content: "", 
          error: { status: 500, message: "Internal Server Error" },
        },
        manualTrigger: true,
      });

      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app_initialized");

      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Content of B from v1/,
      );
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v1/,
      );

      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "v2");
      await settingsPage.saveSnippet();

      const snippetB = settingsPage.getSnippetItemView("B");
      const snippetC = settingsPage.getSnippetItemView("C");

      await expect(snippetB.getByTestId("regenerating-spinner")).toBeVisible();

      await expect.poll(async () => chatMocker.getPendingTriggerCount()).toBe(1);
      await chatMocker.resolveNextCompletion();

      await expect(
        snippetB.getByTestId("regenerating-spinner"),
      ).not.toBeVisible();
      await expect(snippetB.getByTestId("generation-error-message")).toHaveText(
        "Generation failed: 500 Internal Server Error",
      );

      await expect
        .poll(
          async () => snippetC.getByTestId("regenerating-spinner").isVisible(),
          { timeout: 1000 },
        )
        .toBe(false);

      await expect(snippetC.getByTestId("generation-error-message")).toHaveText(
        "Generation failed: Upstream dependency @B failed to generate.",
      );
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v1/,
      );

      chatMocker.verifyComplete();
    });
  });
});
