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

test.describe("Generated Snippets", () => {
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
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

    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test.describe("from a clean state", () => {
    test.beforeEach(async ({ context }) => {
      await seedIndexedDB(context, { snippets: [] });
      await settingsPage.goto();
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
    test.beforeEach(async ({ context }) => {
      await seedIndexedDB(context, {
        snippets: [
          {
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
      await settingsPage.goto();
    });

    test("resolves snippets in the prompt before generation", async () => {
      // Purpose: This test ensures that if a generated snippet's prompt contains a reference
      // to another snippet (e.g., '@topic'), that reference is resolved to its content before
      // the prompt is sent to the API for generation.
      // 1. Mock the API call for the generated snippet.
      // The key part is that the 'content' of the user message must be the *resolved* prompt.
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

      // 2. Create the generated snippet that references the first snippet.
      await settingsPage.createGeneratedSnippet(
        "story",
        "Tell me a story about @topic",
        "mock-model/mock-model",
        "Mock Model",
      );

      // 3. Assert that the generated content is correct.
      await settingsPage.expectGeneratedSnippetContent(
        "story",
        /Once upon a time/,
      );

      // 4. Verify the mock was hit with the correct, resolved prompt.
      chatMocker.verifyComplete();
    });
  });
});

test.describe("Automatic Regeneration", () => {
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
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

    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test("regenerates a dependent snippet when its dependency is updated", async ({
    context,
  }) => {
    // Purpose: This test verifies that when a standard snippet (A) is updated, any generated
    // snippet (B) that depends on it (i.e., uses '@A' in its prompt) is automatically
    // and correctly regenerated in the background.
    await seedIndexedDB(context, { snippets: [] });
    await settingsPage.goto();

    // 1. Create initial snippets: A (base) and B (depends on A)
    await settingsPage.createNewSnippet("A", "World");
    // The initial content here is just a placeholder, the main point is the prompt.
    await settingsPage.createGeneratedSnippet(
      "B",
      "Hello @A",
      "mock-model/mock-model",
      "Mock Model",
    );

    // 2. Set up the mock for the regeneration of B, which will be triggered by the update to A.
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

    // 3. Update snippet A, which should trigger regeneration of B
    await settingsPage.startEditingSnippet("A");
    await settingsPage.fillSnippetForm("A", "Universe");
    await settingsPage.saveSnippet();

    // 4. Verify that the content of B is updated after the regeneration
    await settingsPage.expectGeneratedSnippetContent(
      "B",
      /Updated content for B/,
    );
    chatMocker.verifyComplete();
  });

  test.describe("with a dependency chain", () => {
    test.beforeEach(async ({ context }) => {
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
      await settingsPage.goto();
    });

    test("transitively regenerates snippets in the correct order", async () => {
      // Purpose: This test verifies that automatic regeneration works for a chain of dependencies
      // (e.g., C depends on B, B depends on A). When the base snippet (A) is updated, it
      // should trigger a cascading regeneration of B, and then C, in the correct order.
      // 1. Verify initial state
      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Content of B from v1/,
      );
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v1/,
      );

      // 2. Set up mocks for the transitive regeneration
      chatMocker.mock({
        // Regeneration of B after A is updated
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Prompt for B using v2" }],
          stream: false,
        },
        response: { role: "assistant", content: "Content of B from v2" },
        manualTrigger: true,
      });
      chatMocker.mock({
        // Regeneration of C after B is updated
        request: {
          model: "mock-model/mock-model",
          messages: [
            {
              role: "user",
              content: "Prompt for C using Content of B from v2",
            },
          ],
          stream: false,
        },
        response: { role: "assistant", content: "Content of C from B_v2" },
        manualTrigger: true,
      });

      // 3. Update the base snippet 'A', which should trigger the chain reaction
      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "v2");
      await settingsPage.saveSnippet();

      // 4. Assert that B regenerates first, then C, and that the global spinner is visible throughout
      const snippetB = settingsPage.getSnippetItem("B");
      const snippetC = settingsPage.getSnippetItem("C");

      // Wait for B to start regenerating and resolve it
      await expect(settingsPage.navigation.settingsTabSpinner).toBeVisible();
      await expect(snippetB.getByTestId("regenerating-spinner")).toBeVisible();
      await chatMocker.resolveNextCompletion();
      await expect(
        snippetB.getByTestId("regenerating-spinner"),
      ).not.toBeVisible();
      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Content of B from v2/,
      );

      // Global spinner should still be visible as C is pending
      await expect(settingsPage.navigation.settingsTabSpinner).toBeVisible();

      // Wait for C to start regenerating and resolve it
      await expect(snippetC.getByTestId("regenerating-spinner")).toBeVisible();
      await chatMocker.resolveNextCompletion();
      await expect(
        snippetC.getByTestId("regenerating-spinner"),
      ).not.toBeVisible();
      await settingsPage.expectGeneratedSnippetContent(
        "C",
        /Content of C from B_v2/,
      );

      // Global spinner should now be gone
      await expect(
        settingsPage.navigation.settingsTabSpinner,
      ).not.toBeVisible();

      // 5. Verify all mocks were consumed in the correct order
      chatMocker.verifyComplete();
    });
  });

  test.describe("with a dependency that becomes empty", () => {
    test.beforeEach(async ({ context }) => {
      await seedIndexedDB(context, {
        snippets: [
          {
            name: "A",
            content: "Initial Text",
            isGenerated: false,
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: false,
          },
          {
            name: "B",
            content: "Initial content for B",
            isGenerated: true,
            prompt: "@A",
            model: "mock-model/mock-model",
            createdAt_ms: 1,
            updatedAt_ms: 1,
            generationError: null,
            isDirty: false,
          },
        ],
      });
      await settingsPage.goto();
    });

    test("skips automatic regeneration if the resolved prompt is empty", async () => {
      // Purpose: This test ensures that if an update to a dependency causes a generated
      // snippet's prompt to become empty, the system correctly clears the snippet's content
      // and skips making an unnecessary API call for regeneration.
      await settingsPage.expectGeneratedSnippetContent(
        "B",
        /Initial content for B/,
      );

      // No more mocks are needed as the regeneration should be skipped.

      // 1. Update snippet A to be empty (whitespace)
      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "   ");
      await settingsPage.saveSnippet();

      // 2. Assert that snippet B's content has been cleared.
      // It might take a moment for the background task to complete.
      await expect(
        async () => await settingsPage.expectGeneratedSnippetContent("B", /^$/),
      ).toPass();

      // 3. Verify no unexpected API calls were made
      chatMocker.verifyComplete();
    });
  });
});
