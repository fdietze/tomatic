import { type Page, type Locator } from '@playwright/test';

/**
 * Page Object Model for the main navigation components of the application.
 * This includes the header buttons for chat, settings, and session navigation.
 */
export class NavigationComponent {
  readonly newChatButton: Locator;
  readonly settingsButton: Locator;
  readonly nextSessionButton: Locator;
  readonly prevSessionButton: Locator;
  readonly settingsTabSpinner: Locator;

  constructor(public readonly page: Page) {
    this.newChatButton = page.getByTestId('chat-button');
    this.settingsButton = page.getByTestId('settings-button');
    this.nextSessionButton = page.getByTestId('next-session-button');
    this.prevSessionButton = page.getByTestId('prev-session-button');
    this.settingsTabSpinner = page.getByTestId('settings-tab-spinner');
  }

  async goToNewChat() {
    await this.newChatButton.click();
    await this.page.waitForURL('**/chat/new');
  }

  async goBackToChat() {
    await this.newChatButton.click();
  }

  async goToSettings() {
    await this.settingsButton.click();
    await this.page.waitForURL('**/settings');
  }

  async goToNextSession() {
    await this.nextSessionButton.click();
  }

  async goToPrevSession() {
    await this.prevSessionButton.click();
  }
}