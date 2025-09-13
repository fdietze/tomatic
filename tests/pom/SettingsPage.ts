import { type Page, type Locator, expect } from '@playwright/test';

import { NavigationComponent } from './NavigationComponent';
import { ModelComboboxPage } from './ModelComboboxPage';
/**
 * Page Object Model for the Settings page.
 * This class encapsulates locators and actions for managing system prompts,
 * making the tests cleaner and more maintainable.
 */
export class SettingsPage {
  // --- Locators ---
  readonly newPromptButton: Locator;
   readonly newSnippetButton: Locator;
  readonly navigation: NavigationComponent;
  readonly modelCombobox: ModelComboboxPage;

  constructor(public readonly page: Page) {
    this.newPromptButton = page.getByTestId('new-system-prompt-button');
     this.newSnippetButton = page.getByTestId('new-snippet-button');
    this.navigation = new NavigationComponent(page);
    this.modelCombobox = new ModelComboboxPage(page);
  }

  // --- Actions ---

  /**
   * Navigates to the settings page.
   */
  async goto() {
     await this.page.goto('/settings');
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


  // --- Snippet Actions ---

  async createNewSnippet(name: string, content: string) {
    await this.newSnippetButton.click();
    const editContainer = this.page.getByTestId('snippet-item-edit-new');
    await editContainer.getByTestId('snippet-name-input').fill(name);
    await editContainer.getByTestId('snippet-content-input').fill(content);
    await editContainer.getByTestId('snippet-save-button').click();
    await expect(editContainer).not.toBeVisible();
    await expect(this.getSnippetItem(name)).toBeVisible();
  }

  async deleteSnippet(name: string) {
    await this.getSnippetItem(name).getByTestId('snippet-delete-button').click();
  }

  async startEditingSnippet(name: string) {
    await this.getSnippetItem(name).getByTestId('snippet-edit-button').click();
  }

  async fillSnippetForm(name: string, content: string) {
    const editContainer = this.page.locator('[data-testid^="snippet-item-edit-"]');
    await editContainer.getByTestId('snippet-name-input').fill(name);
    await editContainer.getByTestId('snippet-content-input').fill(content);
  }

  async fillGeneratedSnippetForm(options: { name?: string; prompt?: string; modelName?: string; modelId?: string }) {
    const editContainer = this.page.locator('[data-testid^="snippet-item-edit-"]');
    if (options.name) {
      await editContainer.getByTestId('snippet-name-input').fill(options.name);
    }
    if (options.prompt) {
      await editContainer.getByTestId('snippet-prompt-input').fill(options.prompt);
    }
    if (options.modelName && options.modelId) {
      await this.modelCombobox.selectModel(options.modelName, options.modelId);
    }
  }

  async saveSnippet() {
    const editContainer = this.page.locator('[data-testid^="snippet-item-edit-"]');
    await editContainer.getByTestId('snippet-save-button').click();
  }

  async createGeneratedSnippet(name: string, prompt: string, modelId: string, modelName?: string) {
    await this.newSnippetButton.click();
    const editContainer = this.page.getByTestId('snippet-item-edit-new');
    await editContainer.getByTestId('snippet-name-input').fill(name);
    await editContainer.getByText('Generated Snippet').click();
    await this.modelCombobox.selectModel(modelName ?? modelId, modelId);
    await editContainer.getByTestId('snippet-prompt-input').fill(prompt);
    // With the new refactored flow, we no longer need to manually regenerate.
    // The save button now handles generation.
    await editContainer.getByTestId('snippet-save-button').click();

    // Wait for the save operation (which includes generation) to complete.
    await expect(editContainer).not.toBeVisible();
    await expect(this.getSnippetItem(name)).toBeVisible();
    // Also wait for the spinner to disappear to ensure generation is complete
    await expect(this.getSnippetItem(name).getByTestId('regenerating-spinner')).not.toBeVisible({ timeout: 10000 });
  }

  // --- Snippet Helpers ---

  getSnippetItem(name: string): Locator {
    return this.page.getByTestId(`snippet-item-${name}`);
  }

  getSnippetEditContainer(name: string): Locator {
    return this.page.getByTestId(`snippet-item-edit-${name}`);
  }

  getNewSnippetEditContainer(): Locator {
    return this.page.getByTestId('snippet-item-edit-new');
  }

  getSnippetNameInput(container: Locator): Locator {
    return container.getByTestId('snippet-name-input');
  }

  getSnippetSaveButton(container: Locator): Locator {
    return container.getByTestId('snippet-save-button');
  }

  getSnippetErrorMessage(container: Locator): Locator {
    return container.getByTestId('error-message');
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

  async expectSnippetToBeVisible(name: string) {
    await expect(this.getSnippetItem(name)).toBeVisible();
  }

  /**
   * Asserts that a prompt with the given name does not exist.
   * @param name The name of the prompt.
   */
  async expectPromptToNotExist(name: string) {
    await expect(this.getPromptItem(name)).not.toBeVisible();
  }

  async expectSnippetToNotExist(name: string) {
    await expect(this.getSnippetItem(name)).not.toBeVisible();
  }

  async expectGeneratedSnippetContent(name: string, expectedContent: string | RegExp) {
    // In view mode, the content is in a different element
    const contentLocator = this.getSnippetItem(name).locator('.system-prompt-text');
    await expect(contentLocator).toHaveText(expectedContent);
  }

  async expectGenerationErrorMessage(message: string | RegExp) {
    await expect(this.page.getByTestId('generation-error-message')).toHaveText(message);
  }
  /**
   * Asserts that a specific error message is visible.
   * @param message The exact error message text.
   */
  async expectErrorMessage(message: string) {
    await expect(this.page.getByTestId('error-message')).toHaveText(message);
  }
}
