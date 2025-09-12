
import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { ChatPage } from './pom/ChatPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB } from './test-helpers';

test.describe('Snippet Management (CRUD)', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: {
          apiKey: OPENROUTER_API_KEY,
        },
        version: 1,
      },
    });

    settingsPage = new SettingsPage(page);
    await settingsPage.goto();
  });

  test('creates a new standard snippet', async () => {
    await settingsPage.createNewSnippet('greet', 'Hello, world!');

    await settingsPage.expectSnippetToBeVisible('greet');
    await expect(settingsPage.getSnippetItem('greet')).toHaveText(/Hello, world!/);
  });

  test('updates an existing snippet', async () => {
    await settingsPage.createNewSnippet('my_snippet', 'Initial content');
    await settingsPage.expectSnippetToBeVisible('my_snippet');

    await settingsPage.startEditingSnippet('my_snippet');
    await settingsPage.fillSnippetForm('my_renamed_snippet', 'Updated content');
    await settingsPage.saveSnippet();

    await settingsPage.expectSnippetToNotExist('my_snippet');
    await settingsPage.expectSnippetToBeVisible('my_renamed_snippet');
    await expect(settingsPage.getSnippetItem('my_renamed_snippet')).toHaveText(/Updated content/);
  });

  test('deletes a snippet', async () => {
    await settingsPage.createNewSnippet('to_delete', 'I am temporary');
    await settingsPage.expectSnippetToBeVisible('to_delete');

    await settingsPage.deleteSnippet('to_delete');

    await settingsPage.expectSnippetToNotExist('to_delete');
  });
});


test.describe('Generated Snippets', () => {
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY, snippets: [] },
        version: 1,
      },
    });

    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    await settingsPage.goto();
  });

  test('UI shows correct fields for a generated snippet', async ({ page }) => {
    await settingsPage.newSnippetButton.click();
    const editContainer = page.getByTestId('snippet-item-edit-new');

    // Initially, content is an editable textarea
    await expect(editContainer.getByTestId('snippet-content-input')).toBeVisible();
    await expect(editContainer.getByTestId('snippet-prompt-input')).not.toBeVisible();
    await expect(page.getByTestId('model-combobox-input')).not.toBeVisible();
    await expect(editContainer.getByTestId('snippet-content-display')).not.toBeVisible();

    // Check the "Generated Snippet" box
    await editContainer.getByText('Generated Snippet').click();

    // Now, prompt and model are visible, and content is a read-only display
    await expect(editContainer.getByTestId('snippet-prompt-input')).toBeVisible();
    await expect(page.getByTestId('model-combobox-input')).toBeVisible();
    await expect(editContainer.getByTestId('snippet-content-display')).toBeVisible();
    await expect(editContainer.getByTestId('snippet-content-input')).not.toBeVisible();
  });

  test('creates a new generated snippet', async () => {
    chatMocker.mock({
      request: {
        model: 'mock-model/mock-model',
        messages: [{ role: 'user', content: 'Tell me a joke' }],
      },
      response: { role: 'assistant', content: 'Why did the scarecrow win an award? Because he was outstanding in his field!' },
    });

    await settingsPage.createGeneratedSnippet('joke', 'Tell me a joke', 'mock-model/mock-model', 'Mock Model');

    await settingsPage.expectSnippetToBeVisible('joke');
    await settingsPage.expectGeneratedSnippetContent('joke', /outstanding in his field/);

    chatMocker.verifyComplete();
  });

  test('updates a generated snippet', async () => {
    // 1. Mock initial creation
    chatMocker.mock({
      request: {
        model: 'mock-model/mock-model',
        messages: [{ role: 'user', content: 'Tell me a joke' }],
      },
      response: { role: 'assistant', content: 'Why did the scarecrow win an award? Because he was outstanding in his field!' },
    });
    await settingsPage.createGeneratedSnippet('joke', 'Tell me a joke', 'mock-model/mock-model', 'Mock Model');
    await settingsPage.expectSnippetToBeVisible('joke');
    await settingsPage.expectGeneratedSnippetContent('joke', /outstanding in his field/);

    // 2. Mock the update/regeneration
    chatMocker.mock({
      request: {
        model: 'mock-model/mock-model',
        messages: [{ role: 'user', content: 'Tell me a short story' }],
      },
      response: { role: 'assistant', content: 'Once upon a time...' },
    });

    // 3. Perform the update
    await settingsPage.startEditingSnippet('joke');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');
    await settingsPage.fillGeneratedSnippetForm({ name: 'joke_story', prompt: 'Tell me a short story' });
    await editContainer.getByTestId('snippet-regenerate-button').click();
    await settingsPage.saveSnippet();

    // 4. Verify the update
    await settingsPage.expectSnippetToNotExist('joke');
    await settingsPage.expectSnippetToBeVisible('joke_story');
    await settingsPage.expectGeneratedSnippetContent('joke_story', /Once upon a time/);

    // 5. Verify mocks
    chatMocker.verifyComplete();
  });

  test('resolves snippets in the prompt before generation', async () => {
    // 1. Create a standard snippet that will be referenced.
    await settingsPage.createNewSnippet('topic', 'space exploration');

    // 2. Mock the API call for the generated snippet.
    // The key part is that the 'content' of the user message must be the *resolved* prompt.
    chatMocker.mock({
      request: {
        model: 'mock-model/mock-model',
        messages: [{ role: 'user', content: 'Tell me a story about space exploration' }],
      },
      response: { role: 'assistant', content: 'Once upon a time, in a galaxy far, far away...' },
    });

    // 3. Create the generated snippet that references the first snippet.
    await settingsPage.createGeneratedSnippet(
      'story',
      'Tell me a story about @topic',
      'mock-model/mock-model',
      'Mock Model'
    );

    // 4. Assert that the generated content is correct.
    await settingsPage.expectGeneratedSnippetContent('story', /Once upon a time/);

    // 5. Verify the mock was hit with the correct, resolved prompt.
    chatMocker.verifyComplete();
  });
});

test.describe('Automatic Regeneration', () => {
	let settingsPage: SettingsPage;
	let chatMocker: ChatCompletionMocker;

	test.beforeEach(async ({ context, page }) => {
		await mockGlobalApis(context);
		await seedLocalStorage(context, {
			'tomatic-storage': {
				state: { apiKey: OPENROUTER_API_KEY, snippets: [] },
				version: 1,
			},
		});

		settingsPage = new SettingsPage(page);
		chatMocker = new ChatCompletionMocker(page);
		await chatMocker.setup();
		await settingsPage.goto();
	});

	test('regenerates a dependent snippet when its dependency is updated', async () => {
		// 1. Mock the initial generation of snippet B
		chatMocker.mock({
			request: {
				model: 'mock-model/mock-model',
				messages: [{ role: 'user', content: 'Hello World' }],
			},
			response: { role: 'assistant', content: 'Initial content for B' },
		});

		// 2. Create the snippets
		await settingsPage.createNewSnippet('A', 'World');
		await settingsPage.createGeneratedSnippet(
			'B',
			'Hello @A',
			'mock-model/mock-model',
			'Mock Model',
		);
		await settingsPage.expectGeneratedSnippetContent('B', /Initial content for B/);

		// 3. Mock the regeneration of snippet B, which will be triggered by updating A
		chatMocker.mock({
			request: {
				model: 'mock-model/mock-model',
				messages: [{ role: 'user', content: 'Hello Universe' }],
			},
			response: { role: 'assistant', content: 'Updated content for B' },
		});

		// 4. Update snippet A
		await settingsPage.startEditingSnippet('A');
		await settingsPage.fillSnippetForm('A', 'Universe');
		await settingsPage.saveSnippet();

		// 5. Assert that snippet B's content has been updated.
		// Playwright's expect has a built-in timeout, so it will wait for the regeneration to complete.
		await settingsPage.expectGeneratedSnippetContent('B', /Updated content for B/);

		// 6. Verify all mocks were consumed
		chatMocker.verifyComplete();
	});

	test('transitively regenerates snippets in the correct order', async () => {
		// 1. Set up mocks for the initial creation of B and C
		chatMocker.mock({ // Initial generation of B
			request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] },
			response: { role: 'assistant', content: 'Content of B from v1' },
		});
		chatMocker.mock({ // Initial generation of C
			request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for C using Content of B from v1' }] },
			response: { role: 'assistant', content: 'Content of C from B_v1' },
		});

		// 2. Create the snippet chain: C -> B -> A
		await settingsPage.createNewSnippet('A', 'v1');
		await settingsPage.createGeneratedSnippet('B', 'Prompt for B using @A', 'mock-model/mock-model', 'Mock Model');
		await settingsPage.createGeneratedSnippet('C', 'Prompt for C using @B', 'mock-model/mock-model', 'Mock Model');
		
		// 3. Verify initial state
		await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v1/);
		await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);

		// 4. Set up mocks for the transitive regeneration
		chatMocker.mock({ // Regeneration of B after A is updated
			request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v2' }] },
			response: { role: 'assistant', content: 'Content of B from v2' },
		});
		chatMocker.mock({ // Regeneration of C after B is updated
			request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for C using Content of B from v2' }] },
			response: { role: 'assistant', content: 'Content of C from B_v2' },
		});

		// 5. Update the base snippet 'A', which should trigger the chain reaction
		await settingsPage.startEditingSnippet('A');
		await settingsPage.fillSnippetForm('A', 'v2');
		await settingsPage.saveSnippet();

		// 6. Assert that both B and C have been regenerated with the new content
		await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v2/);
		await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v2/);

		// 7. Verify all mocks were consumed in the correct order
		chatMocker.verifyComplete();
	});
});

test.describe('Generated Snippets (Error Handling)', () => {
  test.use({ expectedConsoleErrors: [/Internal Server Error/] });
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY, snippets: [] },
        version: 1,
      },
    });

    settingsPage = new SettingsPage(page);
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    await settingsPage.goto();
  });

  test('shows an error if snippet generation fails', async () => {
    await settingsPage.page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Internal Server Error' } }),
      });
    });

    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.page.getByTestId('snippet-item-edit-new');
    await editContainer.getByTestId('snippet-name-input').fill('bad_joke');
    await editContainer.getByText('Generated Snippet').click();
    await settingsPage.modelCombobox.selectModel('Mock Model', 'mock-model/mock-model');
    await editContainer.getByTestId('snippet-prompt-input').fill('This will fail');
    await editContainer.getByTestId('snippet-regenerate-button').click();

    // The edit form should remain open and show an error
    await expect(editContainer).toBeVisible();
    await settingsPage.expectGenerationErrorMessage(/Generation failed:/);
  });
});

test.describe('Snippet Usage in Chat', () => {
  let chatPage: ChatPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: {
          apiKey: OPENROUTER_API_KEY,
        },
        version: 1,
      },
    });

    // Seed all snippets needed for this test suite
    await seedIndexedDB(context, {
      snippets: [
        { name: 'greet_simple', content: 'Hello, world!', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'greet_nested', content: 'Hello, @name!', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'name', content: 'World', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'cycle_a', content: 'This is a @cycle_b', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'cycle_b', content: 'which contains @cycle_a', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'cycle_self', content: 'This is a @cycle_self', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
      ],
    });

    chatPage = new ChatPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    await chatPage.goto();
  });

  test('resolves a standard snippet in the chat input', async ({ page }) => {
    chatMocker.mock({
      request: {
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Hello, world!' }],
      },
      response: { role: 'assistant', content: 'Resolved snippet response.' },
    });

    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.sendMessage('@greet_simple');
    await responsePromise;

    // The user message should display the raw input, not the resolved content
    await chatPage.expectMessage(0, 'user', /@greet_simple/);
    // The assistant response should be visible
    await chatPage.expectMessage(1, 'assistant', /Resolved snippet response/);
    // The API mock should have been hit correctly with the resolved content
    chatMocker.verifyComplete();
  });

  test('resolves nested snippets in the chat input', async ({ page }) => {
    chatMocker.mock({
      request: {
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Hello, World!' }],
      },
      response: { role: 'assistant', content: 'Nested resolution successful.' },
    });

    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.sendMessage('@greet_nested');
    await responsePromise;

    await chatPage.expectMessage(0, 'user', /@greet_nested/);
    await chatPage.expectMessage(1, 'assistant', /Nested resolution successful/);
    chatMocker.verifyComplete();
  });

  test('shows an error when a snippet is not found', async () => {
    // No API call should be made, so no mock is needed.
    await chatPage.sendMessage('Hello @fake_snippet');

    // Assert that the error message is visible in the UI
    await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
      "Snippet '@fake_snippet' not found."
    );

    // Assert that no messages were sent
    await chatPage.expectMessageCount(0);

    // Verify no unexpected API calls were made
    chatMocker.verifyComplete();
  });

  test('shows an error when a snippet self-references', async () => {
    await chatPage.sendMessage('@cycle_self');

    await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
      'Snippet cycle detected: @cycle_self -> @cycle_self'
    );

    await chatPage.expectMessageCount(0);
    chatMocker.verifyComplete();
  });

  test('shows an error when a multi-step snippet cycle is detected', async () => {
    await chatPage.sendMessage('@cycle_a');

    await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
      'Snippet cycle detected: @cycle_a -> @cycle_b -> @cycle_a'
    );

    await chatPage.expectMessageCount(0);
    chatMocker.verifyComplete();
  });
});

test.describe('Snippet Editor Validation', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY },
        version: 1,
      },
    });

    await seedIndexedDB(context, {
      snippets: [
        { name: 'a', content: 'alpha', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'b', content: '', isGenerated: true, prompt: 'no cycle here', createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'c', content: 'charlie', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'empty', content: '   ', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
      ],
    });

    settingsPage = new SettingsPage(page);
    await settingsPage.goto();
  });

  test('shows a live error when an edit introduces a snippet cycle', async () => {
    // 1. Start editing snippet 'b'
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // 2. Introduce a cycle by making 'b's prompt reference itself
    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt now references @b');
    
    // 3. Assert that the error is shown in the content preview area
    const contentDisplay = editContainer.getByTestId('snippet-content-display');
    await expect(contentDisplay.locator('.error-message')).toHaveText('Snippet cycle detected: @b -> @b');
    
    // 4. The regenerate button should be disabled due to the cycle error.
    await expect(editContainer.getByTestId('snippet-regenerate-button')).toBeDisabled();
    
    // 5. The save button should still be enabled.
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();

    // 6. Save the snippet (which is allowed)
    await settingsPage.saveSnippet();
    
    // 7. The editor should close
    await expect(editContainer).not.toBeVisible();
  });

  test('shows a warning when a generated snippet prompt references a non-existent snippet', async () => {
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nonexistent');
    
    const contentDisplay = editContainer.getByTestId('snippet-content-display');
    await expect(contentDisplay.locator('.error-message')).toHaveText("Warning: Snippet '@nonexistent' not found.");
    
    // Save should still be enabled for warnings
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();
  });

  test('shows a warning when a standard snippet content references a non-existent snippet', async () => {
    // 1. Create a new standard snippet
    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.page.getByTestId('snippet-item-edit-new');

    // 2. Fill the content with a reference to a non-existent snippet
    await editContainer.getByTestId('snippet-content-input').fill('this content references @nonexistent');

    // 3. Assert that the warning is shown below the content input
    await expect(editContainer.locator('.error-message')).toHaveText("Warning: Snippet '@nonexistent' not found.");
    
    // 4. Save should still be enabled
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();
  });

  test('shows both a cycle error and a non-existent snippet warning', async () => {
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // Introduce a cycle and a reference to a non-existent snippet
    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nonexistent and also @b');

    const errorContainer = editContainer.getByTestId('prompt-error-message');
    await expect(errorContainer).toContainText('Snippet cycle detected: @b -> @b');
    await expect(errorContainer).toContainText("Warning: Snippet '@nonexistent' not found.");
  });

  test('shows a cycle error for mixed-type snippet cycles', async () => {
    // 1. Create a new standard snippet 'd' that references generated snippet 'b'
    await settingsPage.createNewSnippet('d', 'Standard snippet referencing @b');

    // 2. Start editing generated snippet 'b'
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid="snippet-item-edit-b"]');

    // 3. Update 'b's prompt to reference standard snippet 'd', creating a cycle: b (prompt) -> d (content) -> b
    await editContainer.getByTestId('snippet-prompt-input').fill('Generated prompt referencing @d');
    
    // 4. Assert that the cycle error is shown in 'b's editor
    const errorContainer = editContainer.getByTestId('prompt-error-message');
    // The starting point of the cycle detection can vary, so we check for the presence of both snippets.
    await expect(errorContainer).toContainText('Snippet cycle detected:');
    await expect(errorContainer).toContainText('@b');
    await expect(errorContainer).toContainText('@d');
  });

  test('can save a generated snippet that references a non-existent snippet', async () => {
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');
    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nope');
    await expect(editContainer.getByTestId('prompt-error-message')).toHaveText("Warning: Snippet '@nope' not found.");

    // The regenerate button should be disabled due to the error.
    await expect(editContainer.getByTestId('snippet-regenerate-button')).toBeDisabled();
    
    // But the save button should be enabled.
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();

    await settingsPage.saveSnippet();

    await settingsPage.expectSnippetToBeVisible('b');
    await expect(editContainer).not.toBeVisible();
    await expect(settingsPage.getSnippetItem('b').locator('.system-prompt-text')).toHaveText('');

    await settingsPage.startEditingSnippet('b');
    await expect(editContainer.getByTestId('prompt-error-message')).toHaveText("Warning: Snippet '@nope' not found.");
  });

  test('regenerates content and saves separately', async ({ page }) => {
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    chatMocker.mock({
      request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'A new prompt' }] },
      response: { role: 'assistant', content: 'A new generated content' },
    });

    // 1. Start editing
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // 2. Change prompt and model
    await settingsPage.fillGeneratedSnippetForm({ prompt: 'A new prompt', modelName: 'Mock Model', modelId: 'mock-model/mock-model' });
    
    // 3. Regenerate
    await editContainer.getByTestId('snippet-regenerate-button').click();

    // 4. Assert new content is in the editor, and editor is still open
    await expect(editContainer.getByTestId('snippet-content-display')).toHaveText(/A new generated content/);
    await expect(editContainer).toBeVisible();

    // 5. Save
    await settingsPage.saveSnippet();

    // 6. Assert editor is closed and final content is displayed
    await expect(editContainer).not.toBeVisible();
    await settingsPage.expectGeneratedSnippetContent('b', /A new generated content/);
    chatMocker.verifyComplete();
  });

  test('skips generation if resolved prompt is empty', async ({ page }) => {
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup(); // No mocks, as no API call should be made

    // 1. Start editing
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // 2. Set prompt to a snippet that will resolve to an empty string
    await editContainer.getByTestId('snippet-prompt-input').fill('@empty');

    // 3. Click regenerate
    await editContainer.getByTestId('snippet-regenerate-button').click();

    // 4. Assert content is now empty and editor is still open.
    // The display should only contain the label, signifying no markdown content.
    await expect(editContainer.getByTestId('snippet-content-display')).toHaveText('Content (read-only)');
    await expect(editContainer).toBeVisible();

    // 5. Save and assert it's saved with empty content
    await settingsPage.saveSnippet();
    await settingsPage.expectGeneratedSnippetContent('b', '');

    chatMocker.verifyComplete(); // Verifies no API call was made
  });
});

test.describe('Chat Regeneration with Snippets', () => {
	let settingsPage: SettingsPage;
	let chatPage: ChatPage;
	let chatMocker: ChatCompletionMocker;

	test('uses updated snippet content when regenerating a response', async ({
		context,
		page,
	}) => {
		// 1. Define Mock Data
		const MOCK_SNIPPET = {
			name: 'greet',
			content: 'Hello',
			isGenerated: false,
			createdAt_ms: 0,
			updatedAt_ms: 0,
			generationError: null,
			isDirty: false,
		};

		const SESSION_WITH_SNIPPET = {
			session_id: 'session-with-snippet',
			name: null,
			messages: [
				{
					id: 'msg1',
					role: 'user' as const,
					content: 'Hello world',
					raw_content: '@greet world',
				},
				{
					id: 'msg2',
					role: 'assistant' as const,
					content: 'Initial response',
					model_name: 'google/gemini-2.5-pro',
				},
			],
			created_at_ms: 1000,
			updated_at_ms: 1000,
		};

		// 2. Seed Data and Mock APIs
		await seedLocalStorage(context, {
			'tomatic-storage': {
				state: { apiKey: OPENROUTER_API_KEY },
				version: 1,
			},
		});
		await seedIndexedDB(context, {
			snippets: [MOCK_SNIPPET],
			chat_sessions: [SESSION_WITH_SNIPPET],
		});
		chatMocker = new ChatCompletionMocker(page);
		await chatMocker.setup();

		// 3. Navigate and create POMs
		await page.goto(`/chat/${SESSION_WITH_SNIPPET.session_id}`);
		chatPage = new ChatPage(page);
		settingsPage = new SettingsPage(page);

		// 4. Verify initial state
		await chatPage.expectMessage(0, 'user', /@greet world/);
		await chatPage.expectMessage(1, 'assistant', /Initial response/);

		// 5. Go to settings and edit the snippet
		await chatPage.navigation.goToSettings();
		await settingsPage.startEditingSnippet('greet');
		await settingsPage.fillSnippetForm('greet', 'Bonjour');
		await settingsPage.saveSnippet();

		// 6. Go back to the chat
		await settingsPage.navigation.goBackToChat();
		await page.waitForURL(`**/chat/session-with-snippet`);

		// The user message display should remain unchanged
		await chatPage.expectMessage(0, 'user', /@greet world/);

		// 7. Mock the regeneration API call with the *new* snippet content
		chatMocker.mock({
			request: {
				model: 'google/gemini-2.5-pro',
				messages: [{ role: 'user', content: 'Bonjour world' }],
			},
			response: { role: 'assistant', content: 'Bonjour, le monde!' },
		});

		// 8. Regenerate
		const responsePromise = page.waitForResponse(
			'https://openrouter.ai/api/v1/chat/completions',
		);
		await chatPage.regenerateMessage(1); // Regenerate assistant message at index 1
		await responsePromise;

		// 9. Assert the UI now shows the new response
		await chatPage.expectMessage(1, 'assistant', /Bonjour, le monde!/);

		// 10. Verify all mocks were consumed
		chatMocker.verifyComplete();
	});
});
