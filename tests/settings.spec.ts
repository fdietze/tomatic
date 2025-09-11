import { test, expect, mockApis } from './fixtures';
import type { SystemPrompt } from '../src/types/storage';

import { SettingsPage } from './pom/SettingsPage';
const MOCK_PROMPTS: SystemPrompt[] = [
  { name: 'Chef', prompt: 'You are a master chef.' },
  { name: 'Pirate', prompt: 'You are a fearsome pirate.' },
];

test.beforeEach(async ({ context, page }) => {
  const settingsPage = new SettingsPage(page);

  // We need to mock APIs before any other action
  await mockApis(context);

  // Seed the OLD localStorage format to test the migration
  await page.addInitScript((prompts) => {
    const persistedState = {
      state: {
        systemPrompts: prompts, // This is the old way
        apiKey: 'TEST_API_KEY',
      },
      version: 0, // IMPORTANT: Set version to 0 to trigger migration
    };
    window.localStorage.setItem('tomatic-storage', JSON.stringify(persistedState));
  }, MOCK_PROMPTS);

  await settingsPage.goto();
});

test.describe('System Prompt CRUD', () => {
  test('displays existing system prompts', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.expectPromptToBeVisible('Chef');
    await expect(settingsPage.getPromptItem('Chef')).toHaveText(/Chef/);
    await settingsPage.expectPromptToBeVisible('Pirate');
    await expect(settingsPage.getPromptItem('Pirate')).toHaveText(/Pirate/);
  });

  test('creates a new system prompt', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.createNewPrompt('Wizard', 'You are a wise wizard.');

    // Verify the new prompt is displayed
    await settingsPage.expectPromptToBeVisible('Wizard');
    await expect(settingsPage.getPromptItem('Wizard')).toHaveText(/wise wizard/);
  });

  test('updates an existing system prompt', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.startEditing('Chef');

    // Edit the fields and save
    await settingsPage.fillPromptForm('Master Chef', 'You are the greatest chef in the world.');
    await settingsPage.savePrompt();

    // Verify the update
    await settingsPage.expectPromptToNotExist('Chef');
    await settingsPage.expectPromptToBeVisible('Master Chef');
    await expect(settingsPage.getPromptItem('Master Chef')).toHaveText(/greatest chef/);
  });

  test('deletes a system prompt', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.expectPromptToBeVisible('Pirate');
    await settingsPage.deletePrompt('Pirate');
    await settingsPage.expectPromptToNotExist('Pirate');
  });

  test('cancels creating a new prompt', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.startCreating();
    await expect(page.getByTestId('system-prompt-name-input')).toBeVisible();
    await settingsPage.cancelEditing();
    await expect(page.getByTestId('system-prompt-name-input')).not.toBeVisible();
  });

  test('cancels editing a prompt', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.startEditing('Chef');

    await settingsPage.fillPromptForm('Baker', 'ignored');
    await settingsPage.cancelEditing();

    // The original prompt should still be there, unchanged
    await settingsPage.expectPromptToNotExist('Baker');
    await settingsPage.expectPromptToBeVisible('Chef');
    await expect(settingsPage.getPromptItem('Chef')).toHaveText(/master chef/);
  });

  test('prevents saving a prompt with an empty name', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm('', 'Some prompt text.');
    await settingsPage.savePrompt();

    // Should show an error and remain in edit mode
    await settingsPage.expectErrorMessage('Name cannot be empty.');
    await expect(page.getByTestId('system-prompt-name-input')).toBeVisible();
  });

  test('prevents saving a prompt with a duplicate name', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm('Chef', 'Another chef prompt.'); // Duplicate name
    await settingsPage.savePrompt();

    // Should show an error and remain in edit mode
    await settingsPage.expectErrorMessage('A prompt with this name already exists.');
    await expect(page.getByTestId('system-prompt-name-input')).toBeVisible();
  });
});
