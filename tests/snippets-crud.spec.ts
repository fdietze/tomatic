import { test } from "./fixtures";
import { SettingsPage } from "./pom/SettingsPage";
import {
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
  seedIndexedDB,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("Snippet Management (CRUD)", () => {
  let settingsPage: SettingsPage;

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
    await page.goto(ROUTES.settings);
  });

  test.describe("when creating a new snippet", () => {
    test.beforeEach(async ({ context }) => {
      // Start with no snippets for this test group
      await seedIndexedDB(context, { snippets: [] });
      await settingsPage.page.reload();
    });

    test("creates a new standard snippet", async () => {
      // Purpose: This test verifies the basic functionality of creating a new, standard
      // (non-generated) snippet on the settings page, starting from a clean slate.
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
      await expect(settingsPage.getSnippetItemView("greet")).toHaveText(
        /Hello, world!/,
      );
    });
  });

  test.describe("with a pre-existing snippet", () => {
    test.beforeEach(async ({ context }) => {
      await seedIndexedDB(context, {
        snippets: [
          {
            id: "snippet-1",
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
      await settingsPage.page.reload(); // Reload to apply seeded data
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
        settingsPage.getSnippetItemView("my_renamed_snippet"),
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
  
  test.describe("with name validation", () => {
      test.beforeEach(async ({ context }) => {
          await seedIndexedDB(context, {
            snippets: [
              {
                id: "existing-snippet-id",
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
          await settingsPage.page.reload();
      });

      test("prevents saving a new snippet with an empty name", async () => {
        // Purpose: This test verifies input validation, ensuring a snippet cannot be saved
        // if its name is empty.
        await settingsPage.newSnippetButton.click();
        const editContainer = settingsPage.getNewSnippetEditContainer();

        await settingsPage.getSnippetSaveButton(editContainer).click();

        await expect(settingsPage.getSnippetErrorMessage(editContainer)).toHaveText(
          "Name cannot be empty.",
        );
        await expect(editContainer).toBeVisible();
      });
  
      test("prevents saving a new snippet with invalid characters", async () => {
        // Purpose: This test verifies input validation, ensuring that a snippet name can only
        // contain alphanumeric characters and underscores.
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
  
      test("prevents saving a new snippet with a duplicate name", async () => {
        // Purpose: This test verifies input validation, ensuring a new snippet cannot be saved
        // if its name already exists (case-insensitively).
        await settingsPage.newSnippetButton.click();
        const editContainer = settingsPage.getNewSnippetEditContainer();
        const nameInput = settingsPage.getSnippetNameInput(editContainer);

        await nameInput.fill("EXISTING_SNIPPET");

        await expect(
          settingsPage.getSnippetErrorMessage(editContainer),
        ).toHaveText("A snippet with this name already exists.");
        await expect(
          settingsPage.getSnippetSaveButton(editContainer),
        ).toBeDisabled();
      });
  });
});
