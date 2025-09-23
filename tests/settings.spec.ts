import { ROUTES } from "@/utils/routes";
import { test } from "./fixtures";
import { SettingsPage } from "./pom/SettingsPage";
import type { SystemPrompt } from "../src/types/storage";
import {
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
  seedIndexedDB,
} from "./test-helpers";

test.describe("Settings Page", () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    settingsPage = new SettingsPage(page);
  });

  test.describe("System Prompt CRUD", () => {
    test.beforeEach(async ({ context, page }) => {
      const MOCK_PROMPTS: SystemPrompt[] = [
        { name: "Chef", prompt: "You are a master chef." },
        { name: "Pirate", prompt: "You are a fearsome pirate." },
      ];
      await seedLocalStorage(context, {
        state: {
          apiKey: OPENROUTER_API_KEY,
          modelName: "google/gemini-2.5-pro",
          autoScrollEnabled: false,
        },
        version: 1,
      });
      await seedIndexedDB(context, { system_prompts: MOCK_PROMPTS });
      await page.goto(ROUTES.settings);
      await page.waitForSelector('[data-testid^="system-prompt-item-"]');
    });

    test("displays existing system prompts", async () => {
      // Purpose: This test verifies that previously saved system prompts are correctly loaded
      // from the database and displayed on the settings page.
      await settingsPage.expectPromptToBeVisible("Chef");
      await expect(settingsPage.getPromptItem("Chef")).toHaveText(/Chef/);
      await settingsPage.expectPromptToBeVisible("Pirate");
      await expect(settingsPage.getPromptItem("Pirate")).toHaveText(/Pirate/);
    });

    test("creates a new system prompt", async () => {
      // Purpose: This test verifies the creation of a new system prompt. It checks that after
      // filling out the form and saving, the new prompt appears in the list.
      await settingsPage.createNewPrompt("Wizard", "You are a wise wizard.");

      await settingsPage.expectPromptToBeVisible("Wizard");
      await expect(settingsPage.getPromptItem("Wizard")).toHaveText(
        /wise wizard/,
      );
    });

    test("updates an existing system prompt", async () => {
      // Purpose: This test verifies that an existing system prompt can be successfully edited
      // and saved. It ensures the old entry is removed and the updated entry is displayed.
      await settingsPage.startEditing("Chef");
      await settingsPage.fillPromptForm(
        "Master_Chef",
        "You are the greatest chef in the world.",
      );
      await settingsPage.savePrompt();
      await expect(
        settingsPage.page.getByTestId("system-prompt-name-input"),
      ).not.toBeVisible();
      await settingsPage.expectPromptToNotExist("Chef");
      await settingsPage.expectPromptToBeVisible("Master_Chef");
      await expect(settingsPage.getPromptItem("Master_Chef")).toHaveText(
        /greatest chef/,
      );
    });

    test("deletes a system prompt", async () => {
      // Purpose: This test verifies the deletion of a system prompt. It ensures that after
      // clicking the delete button, the prompt is removed from the UI.
      await settingsPage.expectPromptToBeVisible("Pirate");
      await settingsPage.deletePrompt("Pirate");
      await settingsPage.expectPromptToNotExist("Pirate");
    });

    test("cancels creating a new prompt", async () => {
      // Purpose: This test verifies that the process of creating a new system prompt can be
      // cancelled. It ensures that after clicking 'cancel', the edit form disappears and
      // no new prompt is created.
      await settingsPage.startCreating();
      await expect(
        settingsPage.page.getByTestId("system-prompt-name-input"),
      ).toBeVisible();
      await settingsPage.cancelEditing();
      await expect(
        settingsPage.page.getByTestId("system-prompt-name-input"),
      ).not.toBeVisible();
    });

    test("cancels editing a prompt", async () => {
      // Purpose: This test verifies that edits to an existing system prompt can be discarded.
      // It checks that after making changes and clicking 'cancel', the prompt reverts to its
      // original state.
      await settingsPage.startEditing("Chef");
      await settingsPage.fillPromptForm("Baker", "ignored");
      await settingsPage.cancelEditing();
      await settingsPage.expectPromptToNotExist("Baker");
      await settingsPage.expectPromptToBeVisible("Chef");
      await expect(settingsPage.getPromptItem("Chef")).toHaveText(
        /You are a master chef/,
      );
    });

    test("prevents saving a prompt with an empty name", async () => {
      // Purpose: This test verifies input validation, specifically that a system prompt cannot
      // be saved with an empty name.
      await settingsPage.startCreating();
      await settingsPage.fillPromptForm("", "Some prompt text.");
      await settingsPage.savePrompt();
      await settingsPage.expectErrorMessage("Name cannot be empty.");
      await expect(
        settingsPage.page.getByTestId("system-prompt-name-input"),
      ).toBeVisible();
    });

    test("prevents saving a prompt with a duplicate name", async () => {
      // Purpose: This test verifies input validation, ensuring that the application prevents
      // the creation of a system prompt with a name that is already in use.
      await settingsPage.startCreating();
      await settingsPage.fillPromptForm("Chef", "Another chef prompt.");
      await settingsPage.expectErrorMessage(
        "A prompt with this name already exists.",
      );
      await expect(
        settingsPage.page.getByTestId("system-prompt-save-button"),
      ).toBeDisabled();
    });

    test("prevents saving a prompt with invalid characters", async () => {
      // Purpose: This test verifies input validation, ensuring that a system prompt's name
      // cannot contain special characters and must be alphanumeric with underscores.
      await settingsPage.startCreating();
      await settingsPage.fillPromptForm("invalid name!", "Some prompt text.");
      await settingsPage.expectErrorMessage(
        "Name can only contain alphanumeric characters and underscores.",
      );
      await expect(
        settingsPage.page.getByTestId("system-prompt-save-button"),
      ).toBeDisabled();
    });
  });

  test.describe("API Key Management", () => {
    test("should save the API key and persist it after reload", async ({
      page,
    }) => {
      // Purpose: This test verifies that the API key is correctly saved and persists
      // across page reloads.
      await page.goto(ROUTES.settings);

      // 1. Verify the initial state is empty
      await expect(settingsPage.apiKeyInput).toHaveValue("");

      // 2. Set and save the API key
      const testApiKey = "test-api-key-12345";
      await settingsPage.setApiKey(testApiKey);
      await expect(settingsPage.apiKeySaveButton).toHaveText("Saved!");

      // 3. Wait for the debounce to trigger the save saga
      await page.waitForTimeout(550);

      // 4. Reload the page and verify the key has persisted
      await page.reload();
      await expect(settingsPage.apiKeyInput).toHaveValue(testApiKey);
    });
  });
});
