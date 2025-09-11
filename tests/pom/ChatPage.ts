import { type Page, type Locator, expect } from '@playwright/test';
import { ModelComboboxPage } from './ModelComboboxPage';

/**
 * Page Object Model for the main chat interface.
 * This class encapsulates the locators and actions for interacting with the chat page,
 * making tests cleaner and more maintainable.
 */
export class ChatPage {
  // --- Locators ---
  readonly chatInput: Locator;
  readonly chatSubmitButton: Locator;
  readonly modelCombobox: ModelComboboxPage;

  constructor(public readonly page: Page) {
    this.chatInput = page.getByTestId('chat-input');
    this.chatSubmitButton = page.getByTestId('chat-submit');
    this.modelCombobox = new ModelComboboxPage(page);
  }

  // --- Actions ---

  /**
   * Navigates to a new chat page.
   */
  async gotoNewChat() {
    await this.page.goto('http://localhost:5173/chat/new');
  }

  /**
   * Sends a message through the chat input.
   * @param message The text to send.
   */
  async sendMessage(message: string) {
    await this.chatInput.fill(message);
    await this.chatSubmitButton.click();
  }

  /**
   * Clicks the regenerate button for a specific message.
   * @param messageIndex The index of the message to regenerate.
   */
  async regenerateMessage(messageIndex: number) {
    const messageLocator = this.page.locator(`[data-testid="chat-message-${String(messageIndex)}"]`);
    await messageLocator.getByRole('button', { name: 'regenerate' }).click();
  }


  /**
   * Clicks the edit button for a message, fills the input, and re-submits.
   * @param messageIndex The index of the message to edit.
   * @param newContent The new content for the message.
   */
  async editMessage(messageIndex: number, newContent: string) {
    const messageLocator = this.page.locator(`[data-testid="chat-message-${String(messageIndex)}"]`);
    await messageLocator.getByRole('button', { name: 'edit' }).click();
    await messageLocator.locator('textarea').fill(newContent);
    await messageLocator.getByRole('button', { name: 'Re-submit' }).click();
  }

  /**
   * Clicks the edit button for a message, then clicks the discard button.
   * @param messageIndex The index of the message to begin editing.
   */
  async cancelEdit(messageIndex: number) {
    const messageLocator = this.page.locator(`[data-testid="chat-message-${String(messageIndex)}"]`);
    await messageLocator.getByRole('button', { name: 'edit' }).click();
    await messageLocator.getByRole('button', { name: 'Discard' }).click();
  }

  // --- Assertions ---

  /**
   * Asserts that a specific chat message has the expected text content.
   *
   * @param messageIndex The zero-based index of the message in the chat history.
   * @param role The role of the message author ('user', 'assistant', or 'system').
   * @param expectedText The text or regex to match against the message content.
   */
  async expectMessage(messageIndex: number, role: 'user' | 'assistant' | 'system', expectedText: string | RegExp) {
    const messageLocator = this.page.locator(
      `[data-testid="chat-message-${String(messageIndex)}"][data-role="${role}"] .chat-message-content`
    );
    await expect(messageLocator).toHaveText(expectedText);
  }

  /**
   * Asserts the total number of messages visible in the chat.
   *
   * @param count The expected number of messages.
   */
  async expectMessageCount(count: number) {
    await expect(this.page.locator('[data-testid^="chat-message-"]')).toHaveCount(count);
  }
}
