import { type Page, type Locator, expect } from '@playwright/test';
import { ModelComboboxPage } from './ModelComboboxPage';
import { NavigationComponent } from './NavigationComponent';

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
  readonly navigation: NavigationComponent;

  constructor(public readonly page: Page) {
    this.chatInput = page.getByTestId('chat-input');
    this.chatSubmitButton = page.getByTestId('chat-submit');
    this.modelCombobox = new ModelComboboxPage(page);
    this.navigation = new NavigationComponent(page);
  }

  // --- Actions ---

  /**
   * Navigates to a new chat page.
   */
  async goto() {
     await this.page.goto('/chat/new');
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
    await messageLocator.getByTestId('regenerate-button').click();
  }


  /**
   * Clicks the edit button for a message, fills the input, and re-submits.
   * @param messageIndex The index of the message to edit.
   * @param newContent The new content for the message.
   */
  async editMessage(messageIndex: number, newContent: string) {
    const messageLocator = this.page.locator(`[data-testid="chat-message-${String(messageIndex)}"]`);
    await messageLocator.getByTestId('edit-button').click();
    await messageLocator.getByTestId('edit-textarea').fill(newContent);
    await messageLocator.getByTestId('resubmit-button').click();
  }

  /**
   * Clicks the edit button for a message, then clicks the discard button.
   * @param messageIndex The index of the message to begin editing.
   */
   async cancelEdit(messageIndex: number, newContent?: string) {
    const messageLocator = this.page.locator(`[data-testid="chat-message-${String(messageIndex)}"]`);
    await messageLocator.getByTestId('edit-button').click();
    if (newContent) {
      await messageLocator.getByTestId('edit-textarea').fill(newContent);
    }
    await messageLocator.getByTestId('discard-edit-button').click();
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
