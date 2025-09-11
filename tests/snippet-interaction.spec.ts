import { test, expect } from '@playwright/test';

test.describe('Snippet Management and Usage', () => {
  test.beforeEach(async ({ page }) => {
    // Clear indexedDB before each test
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase('tomatic_chat_db');
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve();
        deleteRequest.onblocked = () => resolve();
      });
    });
    await page.goto('/settings');
    await page.fill('input[type="text"]', process.env.VITE_OPENROUTER_API_KEY || 'dummy_key');
    await page.click('button:has-text("Save")');
  });

  test('CRUD workflow for a standard snippet', async ({ page }) => {
    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'greet');
    await page.fill('[data-testid="snippet-content-input"]', 'Hello, World!');
    await page.click('[data-testid="snippet-save-button"]');

    await expect(page.locator('[data-testid="snippet-item-greet"]')).toBeVisible();
    await expect(page.locator('.system-prompt-name:has-text("greet")')).toBeVisible();
    await expect(page.locator('.system-prompt-text:has-text("Hello, World!")')).toBeVisible();

    await page.click('[data-testid="snippet-item-greet"] [data-testid="snippet-edit-button"]');
    await page.fill('[data-testid="snippet-content-input"]', 'Hello, Playwright!');
    await page.click('[data-testid="snippet-save-button"]');

    await expect(page.locator('.system-prompt-text:has-text("Hello, Playwright!")')).toBeVisible();

    await page.click('[data-testid="snippet-item-greet"] [data-testid="snippet-delete-button"]');
    await expect(page.locator('[data-testid="snippet-item-greet"]')).not.toBeVisible();
  });

  test('should create a generated snippet and update its content', async ({ page }) => {
    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'generated_greet');
    await page.click('input[type="checkbox"]');

    // The model combobox might take a moment to populate
    await page.waitForSelector('[data-testid="combobox-input"]');
    await page.click('[data-testid="combobox-input"]');
    await page.click('div[role="option"]:has-text("Self-Hosted")');

    await page.fill('[data-testid="snippet-prompt-input"]', 'Say "Hello" in a funny way');
    await page.click('[data-testid="snippet-save-button"]');

    await expect(page.locator('[data-testid="snippet-item-generated_greet"]')).toBeVisible();
    // The content is generated, so we just check that it's not empty
    await expect(page.locator('[data-testid="snippet-item-generated_greet"] .generated-content')).not.toBeEmpty();
  });

  test('chat integration with a snippet', async ({ page }) => {
    // First, create a snippet
    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'test_snippet');
    await page.fill('[data-testid="snippet-content-input"]', 'This is a test.');
    await page.click('[data-testid="snippet-save-button"]');

    // Go to chat and use the snippet
    await page.goto('/chat/new');
    await page.fill('textarea', 'Message with @test_snippet');
    await page.press('textarea', 'Enter');

    // Check that the message appears correctly
    await expect(page.locator('[data-testid="chat-message-1"] .chat-message-content')).toHaveText('Message with @test_snippet');
  });

  test('error handling for non-existent snippet', async ({ page }) => {
    await page.goto('/chat/new');
    await page.fill('textarea', 'Message with @nonexistent');
    await page.press('textarea', 'Enter');

    await expect(page.locator('.error-message-container')).toBeVisible();
    await expect(page.locator('.error-message-container')).toHaveText("Error: Snippet '@nonexistent' not found.");
  });

  test('regeneration flow with updated snippet', async ({ page }) => {
    // 1. Create snippet
    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'regen_snippet');
    await page.fill('[data-testid="snippet-content-input"]', 'Initial content');
    await page.click('[data-testid="snippet-save-button"]');

    // 2. Send message with snippet
    await page.goto('/chat/new');
    await page.fill('textarea', 'Testing @regen_snippet');
    await page.press('textarea', 'Enter');
    await page.waitForSelector('[data-testid="chat-message-2"]'); // Wait for assistant response

    // 3. Edit snippet
    await page.goto('/settings');
    await page.click('[data-testid="snippet-item-regen_snippet"] [data-testid="snippet-edit-button"]');
    await page.fill('[data-testid="snippet-content-input"]', 'Updated content');
    await page.click('[data-testid="snippet-save-button"]');

    // 4. Regenerate response
    await page.goto(page.url().replace('/settings', '/chat/new')); // Go back to the chat
    await page.click('[data-testid="chat-message-2"] button:has-text("regenerate")');

    // We can't directly check the API request here, so we'll rely on the fact that
    // the regeneration button was clicked and the flow was triggered.
    // A more robust test would involve mocking the API and asserting the payload.
    await expect(page.locator('[data-testid="chat-message-3"]')).toBeVisible();
  });

  test('recursive resolution and cycle detection', async ({ page }) => {
    // Create snippets for recursion
    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'a');
    await page.fill('[data-testid="snippet-content-input"]', 'This is @b');
    await page.click('[data-testid="snippet-save-button"]');

    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'b');
    await page.fill('[data-testid="snippet-content-input"]', 'Hello!');
    await page.click('[data-testid="snippet-save-button"]');

    // Test recursion
    await page.goto('/chat/new');
    await page.fill('textarea', '@a');
    await page.press('textarea', 'Enter');
    await expect(page.locator('[data-testid="chat-message-1"]')).toHaveText('This is @b');

    // Create snippets for cycle detection
    await page.goto('/settings');
    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'c');
    await page.fill('[data-testid="snippet-content-input"]', 'Link to @d');
    await page.click('[data-testid="snippet-save-button"]');

    await page.click('button:has-text("New Snippet")');
    await page.fill('[data-testid="snippet-name-input"]', 'd');
    await page.fill('[data-testid="snippet-content-input"]', 'Link back to @c');
    await page.click('[data-testid="snippet-save-button"]');

    // Test cycle detection
    await page.goto('/chat/new');
    await page.fill('textarea', '@c');
    await page.press('textarea', 'Enter');
    await expect(page.locator('.error-message-container')).toBeVisible();
    await expect(page.locator('.error-message-container')).toHaveText('Error: Snippet cycle detected: c -> d -> c');
  });
});
