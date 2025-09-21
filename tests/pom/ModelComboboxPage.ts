import { type Page, type Locator, expect } from "@playwright/test";

/**
 * Page Object Model for the Model Combobox component.
 * This class encapsulates the locators and actions for interacting with the model selector.
 */
export class ModelComboboxPage {
  readonly input: Locator;

  constructor(public readonly page: Page) {
    this.input = page.getByTestId("model-combobox-input");
  }

  /**
   * Selects a model from the model combobox.
   * @param name The name of the model to type into the input to filter the list.
   * @param modelId The unique ID of the model to select, e.g. 'mock-model/mock-model'.
   */
  async selectModel(name: string, modelId: string) {
    console.log(
      `[ModelComboboxPage|selectModel] Filling input with: "${name}"`,
    );
    await this.input.fill(name);
    console.log(
      `[ModelComboboxPage|selectModel] Clicking model item: "${modelId}"`,
    );
    await this.page
      .locator(`[data-testid="model-combobox-item-${modelId}"]`)
      .click();
    console.log(`[ModelComboboxPage|selectModel] Model selected.`);
  }

  /**
   * Asserts that the input has a specific value.
   * @param value The expected value.
   */
  async expectInputValue(value: string | RegExp) {
    await expect(this.input).toHaveValue(value);
  }
}
