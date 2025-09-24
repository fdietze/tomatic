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

test.describe("Generated Snippets", () => {
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
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
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test.describe("from a clean state", () => {
    test.beforeEach(async ({ context, page }) => {
      await seedIndexedDB(context, { snippets: [] });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");
    });

    test("UI shows correct fields for a generated snippet", async ({
      page,
    }) => {
      // Purpose: This test verifies that the UI correctly toggles between the fields for a
      // standard snippet (editable content) and a generated snippet (prompt, model, and
      // read-only content display).
      await settingsPage.newSnippetButton.click();
      const editContainer = page.getByTestId("snippet-item-edit-new");

      // Initially, content is an editable textarea
      await expect(
        editContainer.getByTestId("snippet-content-input"),
      ).toBeVisible();
      await expect(
        editContainer.getByTestId("snippet-prompt-input"),
      ).not.toBeVisible();
      await expect(page.getByTestId("model-combobox-input")).not.toBeVisible();
      await expect(
        editContainer.getByTestId("snippet-content-display"),
      ).not.toBeVisible();

      // Check the "Generated Snippet" box
      await editContainer.getByText("Generated Snippet").click();

      // Now, prompt and model are visible, and content is a read-only display
      await expect(
        editContainer.getByTestId("snippet-prompt-input"),
      ).toBeVisible();
      await expect(page.getByTestId("model-combobox-input")).toBeVisible();
      await expect(
        editContainer.getByTestId("snippet-content-display"),
      ).toBeVisible();
      await expect(
        editContainer.getByTestId("snippet-content-input"),
      ).not.toBeVisible();
    });

    test("creates a new generated snippet", async () => {
      // Purpose: This test verifies the end-to-end flow of creating a new generated snippet.
      // It checks that the prompt is sent to the API and the resulting content is displayed
      // and saved correctly.
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Tell me a joke" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content:
            "Why did the scarecrow win an award? Because he was outstanding in his field!",
        },
      });

      await settingsPage.createGeneratedSnippet(
        "joke",
        "Tell me a joke",
        "mock-model/mock-model",
        "Mock Model",
      );

      await settingsPage.expectSnippetToBeVisible("joke");
      await settingsPage.expectGeneratedSnippetContent(
        "joke",
        /outstanding in his field/,
      );

      chatMocker.verifyComplete();
    });

    test("updates a generated snippet", async () => {
      // Purpose: This test verifies that a user can update all aspects of a generated snippet,
      // including its name, prompt, and model. It ensures that regenerating the snippet with
      // new details works correctly and the final result is saved.
      // 1. Create the initial snippet via the UI
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Tell me a joke" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content:
            "Why did the scarecrow win an award? Because he was outstanding in his field!",
        },
      });
      await settingsPage.createGeneratedSnippet(
        "joke",
        "Tell me a joke",
        "mock-model/mock-model",
        "Mock Model",
      );
      await settingsPage.expectSnippetToBeVisible("joke");

      // 2. Mock the update/regeneration
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Tell me a short story" }],
          stream: false,
        },
        response: { role: "assistant", content: "Once upon a time..." },
      });

      // 3. Perform the update
      await settingsPage.startEditingSnippet("joke");
      const editContainer = settingsPage.page.locator(
        '[data-testid^="snippet-item-edit-"]',
      );
      await settingsPage.fillGeneratedSnippetForm({
        name: "joke_story",
        prompt: "Tell me a short story",
      });
      await editContainer.getByTestId("snippet-regenerate-button").click();
      await settingsPage.saveSnippet();

      // 4. Verify the update
      await settingsPage.expectSnippetToNotExist("joke");
      await settingsPage.expectSnippetToBeVisible("joke_story");
      await settingsPage.expectGeneratedSnippetContent(
        "joke_story",
        /Once upon a time/,
      );

      // 5. Verify mocks
      chatMocker.verifyComplete();
    });
  });

  test.describe("with a dependency snippet", () => {
    test.beforeEach(async ({ context, page }) => {
      await seedIndexedDB(context, {
        snippets: [
          {
            id: "topic-id",
            name: "topic",
            content: "space exploration",
            isGenerated: false,
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: false,
          },
        ],
      });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");
    });

    test("resolves snippets in the prompt before generation", async () => {
      // Purpose: This test ensures that if a generated snippet's prompt contains a reference
      // to another snippet (e.g., '@topic'), that reference is resolved to its content before
      // the prompt is sent to the API for generation.
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [
            {
              role: "user",
              content: "Tell me a story about space exploration",
            },
          ],
          stream: false,
        },
        response: {
          role: "assistant",
          content: "Once upon a time, in a galaxy far, far away...",
        },
      });

      await settingsPage.createGeneratedSnippet(
        "story",
        "Tell me a story about @topic",
        "mock-model/mock-model",
        "Mock Model",
      );

      await settingsPage.expectGeneratedSnippetContent(
        "story",
        /Once upon a time/,
      );

      chatMocker.verifyComplete();
    });
  });

  test.describe("Automatic Regeneration", () => {
    test("regenerates a dependent snippet when its dependency is updated", async ({
      context,
      page,
    }) => {
      // Purpose: This test verifies that when a standard snippet (A) is updated, any generated
      // snippet (B) that depends on it (i.e., uses '@A' in its prompt) is automatically
      // and correctly regenerated in the background.
      await seedIndexedDB(context, { snippets: [] });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");

      await settingsPage.createNewSnippet("A", "World");

      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Hello World" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content: "Initial content for B",
        },
      });
      await settingsPage.createGeneratedSnippet(
        "B",
        "Hello @A",
        "mock-model/mock-model",
        "Mock Model",
      );

      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Hello Universe" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content: "Updated content for B",
        },
      });

      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "Universe");
      await settingsPage.saveSnippet();

      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Updated content for B/,
      );
      chatMocker.verifyComplete();
    });

    test.describe("with a dependency chain", () => {
      test.beforeEach(async ({ context, page }) => {
        await seedIndexedDB(context, {
          snippets: [
            { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            { id: "b", name: "B", content: "Content of B from v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false },
            { id: "c", name: "C", content: "Content of C from B_v1", isGenerated: true, prompt: "Prompt for C using @B", model: "mock-model/mock-model", createdAt_ms: 2, updatedAt_ms: 2, generationError: null, isDirty: false },
          ],
        });
        await page.goto(ROUTES.settings);
        await waitForEvent(page, "app:models_loaded");
      });

      test("transitively regenerates snippets in the correct order", async () => {
        // Purpose: This test verifies that automatic regeneration works for a chain of dependencies
        // (e.g., C depends on B, B depends on A). When the base snippet (A) is updated, it
        // should trigger a cascading regeneration of B, and then C, in the correct order.
        await settingsPage.expectGeneratedSnippetContent("B", /Content of B from v1/);
        await settingsPage.expectGeneratedSnippetContent("C", /Content of C from B_v1/);

        chatMocker.mock({
          request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v2" }], stream: false },
          response: { role: "assistant", content: "Content of B from v2" },
          manualTrigger: true,
        });
        chatMocker.mock({
          request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for C using Content of B from v2" }], stream: false },
          response: { role: "assistant", content: "Content of C from B_v2" },
          manualTrigger: true,
        });

        await settingsPage.startEditingSnippet("A");
        await settingsPage.fillSnippetForm("A", "v2");
        await settingsPage.saveSnippet();

        const snippetB = settingsPage.getSnippetItemView("B");
        const snippetC = settingsPage.getSnippetItemView("C");

        await expect(settingsPage.navigation.settingsTabSpinner).toBeVisible();
        await expect(snippetB.getByTestId("regenerating-spinner")).toBeVisible();
        await chatMocker.resolveNextCompletion();
        await expect(snippetB.getByTestId("regenerating-spinner")).not.toBeVisible();
        await settingsPage.expectGeneratedSnippetContent("B", /Content of B from v2/);

        await expect(settingsPage.navigation.settingsTabSpinner).toBeVisible();

        await expect(snippetC.getByTestId("regenerating-spinner")).toBeVisible();
        await chatMocker.resolveNextCompletion();
        await expect(snippetC.getByTestId("regenerating-spinner")).not.toBeVisible();
        await settingsPage.expectGeneratedSnippetContent("C", /Content of C from B_v2/);

        await expect(settingsPage.navigation.settingsTabSpinner).not.toBeVisible();

        chatMocker.verifyComplete();
      });
    });

    test.describe("with a dependency that becomes empty", () => {
      test.beforeEach(async ({ context, page }) => {
        await seedIndexedDB(context, {
          snippets: [
            { id: "a", name: "A", content: "Initial Text", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            { id: "b", name: "B", content: "Initial content for B", isGenerated: true, prompt: "@A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false },
          ],
        });
        await page.goto(ROUTES.settings);
        await waitForEvent(page, "app:models_loaded");
      });

      test("skips automatic regeneration if the resolved prompt is empty", async () => {
        // Purpose: This test ensures that if an update to a dependency causes a generated
        // snippet's prompt to become empty, the system correctly clears the snippet's content
        // and skips making an unnecessary API call for regeneration.
        await settingsPage.expectGeneratedSnippetContent("B", /Initial content for B/);

        await settingsPage.startEditingSnippet("A");
        await settingsPage.fillSnippetForm("A", "   ");
        await settingsPage.saveSnippet();

        await expect(
          async () => await settingsPage.expectGeneratedSnippetContent("B", /^$/),
        ).toPass();

        chatMocker.verifyComplete();
      });
    });
  });
});
