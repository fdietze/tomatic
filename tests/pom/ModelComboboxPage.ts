import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Model Combobox component.
 * This class encapsulates the locators and actions for interacting with the model selector.
 */
export class ModelComboboxPage {
  readonly input: Locator;

  constructor(public readonly page: Page) {
    this.input = page.getByTestId('model-combobox-input');
  }

  /**
   * Selects a model from the model combobox.
   * @param name The name of the model to select (e.g., 'Mock Model').
   */
  async selectModel(name: string) {
    await this.input.fill(name);
    // The ID in the test is "mock-model/mock-model", but the name is "Mock Model".
    // We need to find the item by its name, not its ID.
    const modelId = this.page.locator(`[data-testid^="model-combobox-item-"]`, { hasText: name });
    await modelId.click();
  }

  /**
   * Asserts that the input has a specific value.
   * @param value The expected value.
   */
  async expectInputValue(value: string | RegExp) {
    await expect(this.input).toHaveValue(value);
  }
}
