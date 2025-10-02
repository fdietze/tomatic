import { type Page, type Locator, expect } from "@playwright/test";
import { ModelComboboxPage } from "./ModelComboboxPage";
import { NavigationComponent } from "./NavigationComponent";
import { ROUTES } from "@/utils/routes";

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
  readonly errorMessage: Locator;
  readonly chatMessages: Locator;

  constructor(public readonly page: Page) {
    this.chatInput = page.getByTestId("chat-input");
    this.chatSubmitButton = page.getByTestId("chat-submit");
    this.modelCombobox = new ModelComboboxPage(page);
    this.navigation = new NavigationComponent(page);
    this.errorMessage = page.getByTestId("error-message");
    this.chatMessages = page.locator('[data-testid^="chat-message-"]');
  }

  async exposeTomaticTestGetStore() {
    await this.page.exposeFunction("tomatic_test_getStore", () => {
      return (
        this.page as unknown as { tomatic_test_getStore: () => unknown }
      ).tomatic_test_getStore();
    });
  }

  async getMessagesFromStore() {
    const messages = await this.page.evaluate(() => {
      const w = window as unknown as { tomatic_test_getStore: () => { getState: () => { session: { messages: unknown[] } } } };
      const state = w.tomatic_test_getStore().getState();
      return state.session.messages;
    });
    return messages;
  }

  // --- Actions ---

  /**
   * Navigates to a new chat page.
   */
  async goto(sessionId: string = "new") {
    await this.page.goto(ROUTES.chat.session(sessionId));
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
    const messageLocator = this.page.locator(
      `[data-testid="chat-message-${String(messageIndex)}"]`,
    );
    await messageLocator.getByTestId("regenerate-button").click();
  }

  /**
   * Clicks the edit button for a message, fills the input, and re-submits.
   * @param messageIndex The index of the message to edit.
   * @param newContent The new content for the message.
   */
  async editMessage(messageIndex: number, newContent: string) {
    await this.startEditingMessage(messageIndex);
    await this.getEditTextArea(messageIndex).fill(newContent);
    await this.resubmitEdit(messageIndex);
  }

  // --- Granular Edit Actions ---

  getMessageLocator(messageIndex: number): Locator {
    return this.page.locator(
      `[data-testid="chat-message-${String(messageIndex)}"]`,
    );
  }

  async startEditingMessage(messageIndex: number) {
    const messageLocator = this.getMessageLocator(messageIndex);
    await messageLocator.getByTestId("edit-button").click();
  }

  getEditTextArea(messageIndex: number): Locator {
    const messageLocator = this.getMessageLocator(messageIndex);
    return messageLocator.getByTestId("edit-textarea");
  }

  async resubmitEdit(messageIndex: number) {
    const messageLocator = this.getMessageLocator(messageIndex);
    await messageLocator.getByTestId("resubmit-button").click();
  }

  /**
   * Clicks the edit button for a message, then clicks the discard button.
   * @param messageIndex The index of the message to begin editing.
   */
  async cancelEdit(messageIndex: number, newContent?: string) {
    const messageLocator = this.page.locator(
      `[data-testid="chat-message-${String(messageIndex)}"]`,
    );
    await messageLocator.getByTestId("edit-button").click();
    if (newContent) {
      await messageLocator.getByTestId("edit-textarea").fill(newContent);
    }
    await messageLocator.getByTestId("discard-edit-button").click();
  }

  // --- Assertions ---

  /**
   * Asserts that a specific chat message has the expected text content.
   *
   * @param messageIndex The zero-based index of the message in the chat history.
   * @param role The role of the message author ('user', 'assistant', or 'system').
   * @param expectedText The text or regex to match against the message content.
   */
  async expectMessage(
    messageIndex: number,
    role: "user" | "assistant" | "system",
    expectedText: string | RegExp,
  ) {
    const messageLocator = this.page.locator(
      `[data-testid="chat-message-${String(messageIndex)}"][data-role="${role}"] .chat-message-content`,
    );

    await expect(messageLocator).toHaveText(expectedText);
  }

  /**
   * Asserts the total number of messages visible in the chat.
   *
   * @param count The expected number of messages.
   */
  async expectMessageCount(count: number) {
    await expect(
      this.page.locator('[data-testid^="chat-message-"]'),
    ).toHaveCount(count);
  }

  /**
   * Asserts that the currently selected system prompt matches the expected name.
   *
   * @param expectedPromptName The name of the expected system prompt.
   */
  async expectSelectedSystemPrompt(expectedPromptName: string | null) {
    if (expectedPromptName === null) {
      // When no prompt is selected, there should be no selected prompt button
      const selectedPromptButton = this.page.locator('[data-testid^="system-prompt-button-"][data-selected="true"]');
      await expect(selectedPromptButton).toHaveCount(0);
    } else {
      // Check that the specific prompt button is selected
      const selectedPromptButton = this.page.getByTestId(`system-prompt-button-${expectedPromptName}`);
      await expect(selectedPromptButton).toHaveAttribute("data-selected", "true");
    }
  }

  /**
   * Clicks a system prompt button to select or deselect it.
   *
   * @param promptName The name of the system prompt button to click.
   */
  async clickSystemPromptButton(promptName: string) {
    const promptButton = this.page.getByTestId(`system-prompt-button-${promptName}`);
    await promptButton.click();
  }
}
