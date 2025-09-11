import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Settings page.
 * This class encapsulates locators and actions for managing system prompts,
 * making the tests cleaner and more maintainable.
 */
export class SettingsPage {
  // --- Locators ---
  readonly newPromptButton: Locator;

  constructor(public readonly page: Page) {
    this.newPromptButton = page.getByRole('button', { name: 'New' });
  }

  // --- Actions ---

  /**
   * Navigates to the settings page.
   */
  async goto() {
    await this.page.goto('http://localhost:5173/settings');
  }

  /**
   * Creates a new system prompt and saves it.
   * @param name The name for the new prompt.
   * @param prompt The content of the new prompt.
   */
  async createNewPrompt(name: string, prompt: string) {
    await this.newPromptButton.click();
    await this.page.getByTestId('system-prompt-name-input').fill(name);
    await this.page.getByTestId('system-prompt-prompt-input').fill(prompt);
    await this.page.getByTestId('system-prompt-save-button').click();
  }

  /**
   * Clicks the 'New' button to start creating a new prompt.
   */
  async startCreating() {
    await this.newPromptButton.click();
  }

  /**
   * Fills the name and prompt content in the edit form.
   * @param name The name to fill in the name input.
   * @param prompt The prompt content to fill in the prompt textarea.
   */
  async fillPromptForm(name: string, prompt: string) {
    await this.page.getByTestId('system-prompt-name-input').fill(name);
    await this.page.getByTestId('system-prompt-prompt-input').fill(prompt);
  }

  /**
   * Clicks the save button in the prompt edit form.
   */
  async savePrompt() {
    await this.page.getByTestId('system-prompt-save-button').click();
  }

  /**
   * Clicks the cancel button in the prompt edit form.
   */
  async cancelEditing() {
    await this.page.getByTestId('system-prompt-cancel-button').click();
  }

  /**
   * Deletes a system prompt by its name.
   * @param name The name of the prompt to delete.
   */
  async deletePrompt(name: string) {
    await this.getPromptItem(name).getByTestId('system-prompt-delete-button').click();
  }

  /**
   * Clicks the 'Edit' button for a specific prompt to enter edit mode.
   * @param name The name of the prompt to edit.
   */
  async startEditing(name: string) {
    await this.getPromptItem(name).getByTestId('system-prompt-edit-button').click();
  }

  // --- Helpers ---

  /**
   * Returns a Locator for a specific system prompt item in the list.
   * @param name The name of the prompt.
   */
  getPromptItem(name: string): Locator {
    return this.page.getByTestId(`system-prompt-item-${name}`);
  }

  // --- Assertions ---

  /**
   * Asserts that a prompt with the given name is visible.
   * @param name The name of the prompt.
   */
  async expectPromptToBeVisible(name: string) {
    await expect(this.getPromptItem(name)).toBeVisible();
  }

  /**
   * Asserts that a prompt with the given name does not exist.
   * @param name The name of the prompt.
   */
  async expectPromptToNotExist(name: string) {
    await expect(this.getPromptItem(name)).not.toBeVisible();
  }

  /**
   * Asserts that a specific error message is visible.
   * @param message The exact error message text.
   */
  async expectErrorMessage(message: string) {
    await expect(this.page.locator('.error-message')).toHaveText(message);
  }
}
