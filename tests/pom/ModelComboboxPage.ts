import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Model Combobox component.
 * This class encapsulates the locators and actions for interacting with the model selector.
 */
export class ModelComboboxPage {
  readonly input: Locator;

  constructor(public readonly page: Page) {
    this.input = page.locator('input[placeholder^="Select or type model ID"]');
  }

  /**
   * Selects a model from the model combobox.
   * @param name The name of the model to select (e.g., 'Mock Model').
   */
  async selectModel(name: string) {
    await this.input.fill(name);
    await this.page.locator('.combobox-item', { hasText: name }).click();
  }

  /**
   * Asserts that the input has a specific value.
   * @param value The expected value.
   */
  async expectInputValue(value: string | RegExp) {
    await expect(this.input).toHaveValue(value);
  }
}
