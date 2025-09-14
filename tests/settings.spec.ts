import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import type { SystemPrompt } from '../src/types/storage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, seedIndexedDB } from './test-helpers';

test.describe('System Prompt CRUD', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {

    await mockGlobalApis(context);
    // 1. Define Mock Data
    const MOCK_PROMPTS: SystemPrompt[] = [
      { name: 'Chef', prompt: 'You are a master chef.' },
      { name: 'Pirate', prompt: 'You are a fearsome pirate.' },
    ];

    // 2. Setup Test State
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: 'google/gemini-2.5-pro',
        cachedModels: [],
        input: '',
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

  test('displays existing system prompts', async () => {
    await settingsPage.expectPromptToBeVisible('Chef');
    await expect(settingsPage.getPromptItem('Chef')).toHaveText(/Chef/);
    await settingsPage.expectPromptToBeVisible('Pirate');
    await expect(settingsPage.getPromptItem('Pirate')).toHaveText(/Pirate/);
  });

  test('creates a new system prompt', async () => {
    await settingsPage.createNewPrompt('Wizard', 'You are a wise wizard.');

    // Verify the new prompt is displayed
    await settingsPage.expectPromptToBeVisible('Wizard');
    await expect(settingsPage.getPromptItem('Wizard')).toHaveText(/wise wizard/);
  });

  test('updates an existing system prompt', async () => {
    await settingsPage.startEditing('Chef');

    // Edit the fields and save
    await settingsPage.fillPromptForm('Master_Chef', 'You are the greatest chef in the world.');
    await settingsPage.savePrompt();

    // Verify the update
    await settingsPage.expectPromptToNotExist('Chef');
    await settingsPage.expectPromptToBeVisible('Master_Chef');
    await expect(settingsPage.getPromptItem('Master_Chef')).toHaveText(/greatest chef/);
  });

  test('deletes a system prompt', async () => {
    await settingsPage.expectPromptToBeVisible('Pirate');
    await settingsPage.deletePrompt('Pirate');
    await settingsPage.expectPromptToNotExist('Pirate');
  });

  test('cancels creating a new prompt', async () => {
    await settingsPage.startCreating();
    await expect(settingsPage.page.getByTestId('system-prompt-name-input')).toBeVisible();
    await settingsPage.cancelEditing();
    await expect(settingsPage.page.getByTestId('system-prompt-name-input')).not.toBeVisible();
  });

  test('cancels editing a prompt', async () => {
    await settingsPage.startEditing('Chef');

    await settingsPage.fillPromptForm('Baker', 'ignored');
    await settingsPage.cancelEditing();

    // The original prompt should still be there, unchanged
    await settingsPage.expectPromptToNotExist('Baker');
    await settingsPage.expectPromptToBeVisible('Chef');
    await expect(settingsPage.getPromptItem('Chef')).toHaveText(/master chef/);
  });

  test('prevents saving a prompt with an empty name', async () => {
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm('', 'Some prompt text.');
    await settingsPage.savePrompt();

    // Should show an error and remain in edit mode
    await settingsPage.expectErrorMessage('Name cannot be empty.');
    await expect(settingsPage.page.getByTestId('system-prompt-name-input')).toBeVisible();
  });

  test('prevents saving a prompt with a duplicate name', async () => {
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm('Chef', 'Another chef prompt.'); // Duplicate name

    // Should show an error and the save button should be disabled
    await settingsPage.expectErrorMessage('A prompt with this name already exists.');
    await expect(settingsPage.page.getByTestId('system-prompt-save-button')).toBeDisabled();
  });

  test('prevents saving a prompt with invalid characters', async () => {
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm('invalid name!', 'Some prompt text.');
    
    await settingsPage.expectErrorMessage('Name can only contain alphanumeric characters and underscores.');
    await expect(settingsPage.page.getByTestId('system-prompt-save-button')).toBeDisabled();
  });
});
