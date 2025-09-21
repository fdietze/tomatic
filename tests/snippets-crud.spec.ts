import { test } from "./fixtures";
import { SettingsPage } from "./pom/SettingsPage";
import {
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
  seedIndexedDB,
} from "./test-helpers";

test.describe("Snippet Management (CRUD)", () => {
  let settingsPage: SettingsPage;

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
  });

  test("creates a new standard snippet", async () => {
    // Purpose: This test verifies the basic functionality of creating a new, standard
    // (non-generated) snippet on the settings page.
    await settingsPage.goto();
    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.page.getByTestId(
      "snippet-item-edit-new",
    );
    await editContainer.getByTestId("snippet-name-input").fill("greet");
    await editContainer
      .getByTestId("snippet-content-input")
      .fill("Hello, world!");
    await editContainer.getByTestId("snippet-save-button").click();
    await expect(editContainer).not.toBeVisible();

    await settingsPage.expectSnippetToBeVisible("greet");
    await expect(settingsPage.getSnippetItem("greet")).toHaveText(
      /Hello, world!/,
    );
  });

  test.describe("with a pre-existing snippet", () => {
    test.beforeEach(async ({ context }) => {
      await seedIndexedDB(context, {
        snippets: [
          {
            name: "my_snippet",
            content: "Initial content",
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

    test("updates an existing snippet", async () => {
      // Purpose: This test verifies that a user can edit an existing snippet's name and
      // content and save the changes.
      await settingsPage.startEditingSnippet("my_snippet");
      await settingsPage.fillSnippetForm(
        "my_renamed_snippet",
        "Updated content",
      );
      await settingsPage.saveSnippet();

      await settingsPage.expectSnippetToNotExist("my_snippet");
      await settingsPage.expectSnippetToBeVisible("my_renamed_snippet");
      await expect(
        settingsPage.getSnippetItem("my_renamed_snippet"),
      ).toHaveText(/Updated content/);
    });

    test("deletes a snippet", async () => {
      // Purpose: This test verifies that a snippet can be successfully deleted from the
      // settings page.
      await settingsPage.expectSnippetToBeVisible("my_snippet");
      await settingsPage.deleteSnippet("my_snippet");
      await settingsPage.expectSnippetToNotExist("my_snippet");
    });
  });
});

test.describe("Snippet Name Validation", () => {
  let settingsPage: SettingsPage;

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
  });

  test("prevents saving a new snippet with an empty name", async () => {
    // Purpose: This test verifies input validation, ensuring a snippet cannot be saved
    // if its name is empty.
    await settingsPage.goto();
    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.getNewSnippetEditContainer();

    // Try to save with the default empty name
    await settingsPage.getSnippetSaveButton(editContainer).click();

    // Should show an error and remain in edit mode
    await expect(settingsPage.getSnippetErrorMessage(editContainer)).toHaveText(
      "Name cannot be empty.",
    );
    await expect(editContainer).toBeVisible();
  });

  test("prevents saving a new snippet with invalid characters", async () => {
    // Purpose: This test verifies input validation, ensuring that a snippet name can only
    // contain alphanumeric characters and underscores.
    await settingsPage.goto();
    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.getNewSnippetEditContainer();
    const nameInput = settingsPage.getSnippetNameInput(editContainer);

    await nameInput.fill("invalid name!");

    await expect(settingsPage.getSnippetErrorMessage(editContainer)).toHaveText(
      "Name can only contain alphanumeric characters and underscores.",
    );
    await expect(
      settingsPage.getSnippetSaveButton(editContainer),
    ).toBeDisabled();
  });

  test.describe("with a pre-existing snippet", () => {
    test.beforeEach(async ({ context }) => {
      await seedIndexedDB(context, {
        snippets: [
          {
            name: "existing_snippet",
            content: "some content",
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

    test("prevents saving a new snippet with a duplicate name", async () => {
      // Purpose: This test verifies input validation, ensuring a new snippet cannot be saved
      // if its name already exists (case-insensitively).
      await settingsPage.newSnippetButton.click();
      const editContainer = settingsPage.getNewSnippetEditContainer();
      const nameInput = settingsPage.getSnippetNameInput(editContainer);

      // Use the same name (case-insensitive)
      await nameInput.fill("EXISTING_SNIPPET");

      // Assert error and disabled button
      await expect(
        settingsPage.getSnippetErrorMessage(editContainer),
      ).toHaveText("A snippet with this name already exists.");
      await expect(
        settingsPage.getSnippetSaveButton(editContainer),
      ).toBeDisabled();
    });
  });
});
