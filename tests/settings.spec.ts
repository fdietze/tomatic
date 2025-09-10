import { test, expect, mockApis } from './fixtures';
import type { SystemPrompt } from '../src/types/storage';

const MOCK_PROMPTS: SystemPrompt[] = [
  { name: 'Chef', prompt: 'You are a master chef.' },
  { name: 'Pirate', prompt: 'You are a fearsome pirate.' },
];

test.beforeEach(async ({ context, page }) => {
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
  await page.goto('http://localhost:5173/settings');
});

test.describe('System Prompt CRUD', () => {
  test('displays existing system prompts', async ({ page }) => {
    await expect(page.getByTestId('system-prompt-item-Chef')).toBeVisible();
    await expect(page.getByTestId('system-prompt-item-Chef')).toHaveText(/Chef/);
    await expect(page.getByTestId('system-prompt-item-Pirate')).toBeVisible();
    await expect(page.getByTestId('system-prompt-item-Pirate')).toHaveText(/Pirate/);
  });

  test('creates a new system prompt', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click();

    // The new prompt item should be in edit mode
    await expect(page.getByTestId('system-prompt-name-input')).toBeVisible();
    await expect(page.getByTestId('system-prompt-name-input')).toBeFocused();

    // Fill and save
    await page.getByTestId('system-prompt-name-input').fill('Wizard');
    await page.getByTestId('system-prompt-prompt-input').fill('You are a wise wizard.');
    await page.getByTestId('system-prompt-save-button').click();

    // Verify the new prompt is displayed
    await expect(page.getByTestId('system-prompt-item-Wizard')).toBeVisible();
    await expect(page.getByTestId('system-prompt-item-Wizard')).toHaveText(/wise wizard/);
  });

  test('updates an existing system prompt', async ({ page }) => {
    const promptItem = page.getByTestId('system-prompt-item-Chef');
    await promptItem.getByTestId('system-prompt-edit-button').click();

    // Edit the fields
    await page.getByTestId('system-prompt-name-input').fill('Master Chef');
    await page
      .getByTestId('system-prompt-prompt-input')
      .fill('You are the greatest chef in the world.');
    await page.getByTestId('system-prompt-save-button').click();

    // Verify the update
    await expect(page.getByTestId('system-prompt-item-Chef')).not.toBeVisible();
    await expect(page.getByTestId('system-prompt-item-Master Chef')).toBeVisible();
    await expect(page.getByTestId('system-prompt-item-Master Chef')).toHaveText(
      /greatest chef/
    );
  });

  test('deletes a system prompt', async ({ page }) => {
    await expect(page.getByTestId('system-prompt-item-Pirate')).toBeVisible();
    const promptItem = page.getByTestId('system-prompt-item-Pirate');
    await promptItem.getByTestId('system-prompt-delete-button').click();

    await expect(page.getByTestId('system-prompt-item-Pirate')).not.toBeVisible();
  });

  test('cancels creating a new prompt', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.getByTestId('system-prompt-name-input')).toBeVisible();
    await page.getByTestId('system-prompt-cancel-button').click();
    await expect(page.getByTestId('system-prompt-name-input')).not.toBeVisible();
  });

  test('cancels editing a prompt', async ({ page }) => {
    const promptItem = page.getByTestId('system-prompt-item-Chef');
    await promptItem.getByTestId('system-prompt-edit-button').click();

    await page.getByTestId('system-prompt-name-input').fill('Baker');
    await page.getByTestId('system-prompt-cancel-button').click();

    // The original prompt should still be there, unchanged
    await expect(page.getByTestId('system-prompt-item-Baker')).not.toBeVisible();
    await expect(page.getByTestId('system-prompt-item-Chef')).toBeVisible();
    await expect(page.getByTestId('system-prompt-item-Chef')).toHaveText(/master chef/);
  });

  test('prevents saving a prompt with an empty name', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByTestId('system-prompt-prompt-input').fill('Some prompt text.');
    await page.getByTestId('system-prompt-save-button').click();

    // Should show an error and remain in edit mode
    await expect(page.locator('.error-message')).toHaveText('Name cannot be empty.');
    await expect(page.getByTestId('system-prompt-name-input')).toBeVisible();
  });

  test('prevents saving a prompt with a duplicate name', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByTestId('system-prompt-name-input').fill('Chef'); // Duplicate name
    await page.getByTestId('system-prompt-prompt-input').fill('Another chef prompt.');
    await page.getByTestId('system-prompt-save-button').click();

    // Should show an error and remain in edit mode
    await expect(page.locator('.error-message')).toHaveText(
      'A prompt with this name already exists.'
    );
    await expect(page.getByTestId('system-prompt-name-input')).toBeVisible();
  });
});
