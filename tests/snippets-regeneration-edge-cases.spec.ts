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
} from "./test-helpers";

test.describe("Automatic Regeneration Edge Cases", () => {
  let settingsPage: SettingsPage;
  // let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page, expectedConsoleErrors }) => {
    expectedConsoleErrors.push(/Internal Server Error/, /Generation failed/);
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        cachedModels: [],
        input: "",
        selectedPromptName: null,
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, {
      snippets: [],
    });

    settingsPage = new SettingsPage(page);
    // chatMocker = new ChatCompletionMocker(page);
    // await chatMocker.setup();
    await page.goto(ROUTES.settings);
  });

  test.describe("halts regeneration when an update introduces a cycle", () => {
    test("halts regeneration", async ({
      page,
      context,
      expectedConsoleErrors,
    }) => {
      expectedConsoleErrors.push(
        /\[validateSnippetDependencies\] Cycle detected/,
      );
      // Purpose: This test ensures that if updating a snippet introduces a dependency cycle,
      // the automatic regeneration process is halted to prevent an infinite loop. The existing
      // content of the dependent snippets should remain unchanged.
      await seedIndexedDB(context, {
        snippets: [
          {
            name: "A",
            content: "v1",
            isGenerated: false,
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: false,
          },
          {
            name: "B",
            content: "Content of B from v1",
            isGenerated: true,
            prompt: "Prompt for B using @A",
            model: "mock-model/mock-model",
            createdAt_ms: 1,
            updatedAt_ms: 1,
            generationError: null,
            isDirty: false,
          },
          {
            name: "C",
            content: "Content of C from B_v1",
            isGenerated: true,
            prompt: "Prompt for C using @B",
            model: "mock-model/mock-model",
            createdAt_ms: 2,
            updatedAt_ms: 2,
            generationError: null,
            isDirty: false,
          },
        ],
      });
      await page.reload();

      // Verify initial state
      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Content of B from v1/,
      );
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v1/,
      );

      // Edit snippet A to create a cycle (A -> C -> B -> A)
      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "v2 referencing @C");
      await settingsPage.saveSnippet();

      // The cycle detection is synchronous and prevents the regeneration saga from
      // being triggered. We can immediately assert that the content has not changed.

      // Assert that content has not changed
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

  test.describe("propagates failures transitively during regeneration", () => {
    test("propagates failures transitively", async ({
      page,
      context,
      expectedConsoleErrors,
    }) => {
      expectedConsoleErrors.push(/Failed to load resource.*500/);
      // Purpose: This test verifies that if a snippet in a dependency chain fails to
      // regenerate, the failure is propagated to all downstream snippets. For example, if
      // C depends on B and B's regeneration fails, C's regeneration should also be
      // marked as failed with a dependency-related error, without attempting an API call.
      const chatMocker = new ChatCompletionMocker(page);
      await chatMocker.setup();

      // Seed initial state
      await seedIndexedDB(context, {
        snippets: [
          {
            name: "A",
            content: "v1",
            isGenerated: false,
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: false,
          },
          {
            name: "B",
            content: "Content of B from v1",
            isGenerated: true,
            prompt: "Prompt for B using @A",
            model: "mock-model/mock-model",
            createdAt_ms: 1,
            updatedAt_ms: 1,
            generationError: null,
            isDirty: false,
          },
          {
            name: "C",
            content: "Content of C from B_v1",
            isGenerated: true,
            prompt: "Prompt for C using @B",
            model: "mock-model/mock-model",
            createdAt_ms: 2,
            updatedAt_ms: 2,
            generationError: null,
            isDirty: false,
          },
        ],
      });
      await page.reload();

      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Content of B from v1/,
      );
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v1/,
      );

      // Mock the regeneration of B to fail
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Prompt for B using v2" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content: "", // Not used
          error: { status: 500, message: "Internal Server Error" },
        },
        manualTrigger: true,
      });

      // Update snippet A to trigger the regeneration chain
      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "v2");
      await settingsPage.saveSnippet();

      const snippetB = settingsPage.getSnippetItem("B");
      const snippetC = settingsPage.getSnippetItem("C");

      // Wait for B to start regenerating, then trigger the mock failure
      await expect(snippetB.getByTestId("regenerating-spinner")).toBeVisible();
      await chatMocker.resolveNextCompletion();

      // Wait for B to finish regenerating (it will show an error)
      await expect(
        snippetB.getByTestId("regenerating-spinner"),
      ).not.toBeVisible();
      await expect(snippetB.getByTestId("generation-error-message")).toHaveText(
        "Generation failed: 500 Internal Server Error",
      );

      // Now wait for C to start and finish its regeneration, which should also fail
      // We expect the spinner to appear, even if briefly.
      await expect
        .poll(
          async () => snippetC.getByTestId("regenerating-spinner").isVisible(),
          { timeout: 1000 },
        )
        .toBe(false);

      // Assert the final state of C
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
