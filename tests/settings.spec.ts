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

test.describe("System Prompt CRUD", () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    // 1. Define Mock Data
    const MOCK_PROMPTS: SystemPrompt[] = [
      { name: "Chef", prompt: "You are a master chef." },
      { name: "Pirate", prompt: "You are a fearsome pirate." },
    ];

    // 2. Setup Test State
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
    await seedIndexedDB(context, { system_prompts: MOCK_PROMPTS });

    // 3. Navigate and provide POM
    settingsPage = new SettingsPage(page);
    await settingsPage.goto();
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
    console.log("[Test] Starting test: creates a new system prompt");
    await settingsPage.createNewPrompt("Wizard", "You are a wise wizard.");
    console.log("[Test] createNewPrompt finished.");

    // Verify the new prompt is displayed
    console.log("[Test] Verifying prompt is visible.");
    await settingsPage.expectPromptToBeVisible("Wizard");
    console.log("[Test] Verifying prompt text.");
    await expect(settingsPage.getPromptItem("Wizard")).toHaveText(
      /wise wizard/,
    );
    console.log("[Test] Finished test: creates a new system prompt");
  });

  test("updates an existing system prompt", async () => {
    // Purpose: This test verifies that an existing system prompt can be successfully edited
    // and saved. It ensures the old entry is removed and the updated entry is displayed.
    console.log(
      "[Test|updates] Starting test: updates an existing system prompt",
    );
    await settingsPage.startEditing("Chef");
    console.log("[Test|updates] After startEditing");

    // Edit the fields and save
    await settingsPage.fillPromptForm(
      "Master_Chef",
      "You are the greatest chef in the world.",
    );
    console.log("[Test|updates] After fillPromptForm");
    await settingsPage.savePrompt();
    console.log("[Test|updates] After savePrompt");

    // Wait for the modal to close before proceeding
    console.log("[Test|updates] Before expect modal not visible");
    await expect(
      settingsPage.page.getByTestId("system-prompt-name-input"),
    ).not.toBeVisible();
    console.log("[Test|updates] After expect modal not visible");

    // Verify the update
    console.log("[Test|updates] Before expectPromptToNotExist");
    await settingsPage.expectPromptToNotExist("Chef");
    console.log("[Test|updates] After expectPromptToNotExist");
    console.log("[Test|updates] Before expectPromptToBeVisible");
    await settingsPage.expectPromptToBeVisible("Master_Chef");
    console.log("[Test|updates] After expectPromptToBeVisible");
    console.log("[Test|updates] Before expect getPromptItem");
    await expect(settingsPage.getPromptItem("Master_Chef")).toHaveText(
      /greatest chef/,
    );
    console.log("[Test|updates] After expect getPromptItem");
    console.log(
      "[Test|updates] Finished test: updates an existing system prompt",
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

    // The original prompt should still be there, unchanged
    await settingsPage.expectPromptToNotExist("Baker");
    await settingsPage.expectPromptToBeVisible("Chef");
    await expect(settingsPage.getPromptItem("Chef")).toHaveText(
      /You are a master chef/,
    );
  });

  test("prevents saving a prompt with an empty name", async () => {
    // Purpose: This test verifies input validation, specifically that a system prompt cannot
    // be saved with an empty name.
    console.log('[Test] Clicking "New Prompt" button');
    await settingsPage.startCreating();
    console.log("[Test] Filling form with empty name");
    await settingsPage.fillPromptForm("", "Some prompt text.");
    console.log('[Test] Clicking "Save"');
    await settingsPage.savePrompt();

    // Should show an error and remain in edit mode
    console.log('[Test] Expecting error message "Name cannot be empty."');
    await settingsPage.expectErrorMessage("Name cannot be empty.");
    console.log("[Test] Expecting name input to be visible");
    await expect(
      settingsPage.page.getByTestId("system-prompt-name-input"),
    ).toBeVisible();
    console.log("[Test] Test finished");
  });

  test("prevents saving a prompt with a duplicate name", async () => {
    // Purpose: This test verifies input validation, ensuring that the application prevents
    // the creation of a system prompt with a name that is already in use.
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm("Chef", "Another chef prompt."); // Duplicate name

    // Should show an error and the save button should be disabled
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
