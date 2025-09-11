import { test, expect } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';

test.describe('System Prompt CRUD', () => {
  test('displays existing system prompts', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.expectPromptToBeVisible('Chef');
    await expect(settingsPage.getPromptItem('Chef')).toHaveText(/Chef/);
    await settingsPage.expectPromptToBeVisible('Pirate');
    await expect(settingsPage.getPromptItem('Pirate')).toHaveText(/Pirate/);
  });

  test('creates a new system prompt', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.createNewPrompt('Wizard', 'You are a wise wizard.');

    // Verify the new prompt is displayed
    await settingsPage.expectPromptToBeVisible('Wizard');
    await expect(settingsPage.getPromptItem('Wizard')).toHaveText(/wise wizard/);
  });

  test('updates an existing system prompt', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.startEditing('Chef');

    // Edit the fields and save
    await settingsPage.fillPromptForm('Master Chef', 'You are the greatest chef in the world.');
    await settingsPage.savePrompt();

    // Verify the update
    await settingsPage.expectPromptToNotExist('Chef');
    await settingsPage.expectPromptToBeVisible('Master Chef');
    await expect(settingsPage.getPromptItem('Master Chef')).toHaveText(/greatest chef/);
  });

  test('deletes a system prompt', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.expectPromptToBeVisible('Pirate');
    await settingsPage.deletePrompt('Pirate');
    await settingsPage.expectPromptToNotExist('Pirate');
  });

  test('cancels creating a new prompt', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.startCreating();
    await expect(settingsPage.page.getByTestId('system-prompt-name-input')).toBeVisible();
    await settingsPage.cancelEditing();
    await expect(settingsPage.page.getByTestId('system-prompt-name-input')).not.toBeVisible();
  });

  test('cancels editing a prompt', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.startEditing('Chef');

    await settingsPage.fillPromptForm('Baker', 'ignored');
    await settingsPage.cancelEditing();

    // The original prompt should still be there, unchanged
    await settingsPage.expectPromptToNotExist('Baker');
    await settingsPage.expectPromptToBeVisible('Chef');
    await expect(settingsPage.getPromptItem('Chef')).toHaveText(/master chef/);
  });

  test('prevents saving a prompt with an empty name', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm('', 'Some prompt text.');
    await settingsPage.savePrompt();

    // Should show an error and remain in edit mode
    await settingsPage.expectErrorMessage('Name cannot be empty.');
    await expect(settingsPage.page.getByTestId('system-prompt-name-input')).toBeVisible();
  });

  test('prevents saving a prompt with a duplicate name', async ({ settingsPageWithPrompts }) => {
    const settingsPage: SettingsPage = settingsPageWithPrompts;
    await settingsPage.startCreating();
    await settingsPage.fillPromptForm('Chef', 'Another chef prompt.'); // Duplicate name
    await settingsPage.savePrompt();

    // Should show an error and remain in edit mode
    await settingsPage.expectErrorMessage('A prompt with this name already exists.');
    await expect(settingsPage.page.getByTestId('system-prompt-name-input')).toBeVisible();
  });
});
