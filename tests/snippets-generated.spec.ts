import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB } from './test-helpers';
test.describe('Generated Snippets', () => {
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: 'google/gemini-2.5-pro',
        cachedModels: [],
        input: '',
        selectedPromptName: null,
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, { snippets: [] });

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
			state: {
				apiKey: OPENROUTER_API_KEY,
				modelName: 'google/gemini-2.5-pro',
				cachedModels: [],
				input: '',
				selectedPromptName: null,
				autoScrollEnabled: false,
			},
			version: 1,
		});
		await seedIndexedDB(context, { snippets: [] });

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

	test('skips automatic regeneration if the resolved prompt is empty', async () => {
		// 1. Mock the initial generation of snippet B
		chatMocker.mock({
			request: {
				model: 'mock-model/mock-model',
				messages: [{ role: 'user', content: 'Initial Text' }],
			},
			response: { role: 'assistant', content: 'Initial content for B' },
		});

		// 2. Create the snippets
		await settingsPage.createNewSnippet('A', 'Initial Text');
		await settingsPage.createGeneratedSnippet(
			'B',
			'@A',
			'mock-model/mock-model',
			'Mock Model',
		);
		await settingsPage.expectGeneratedSnippetContent('B', /Initial content for B/);

		// No more mocks are needed as the regeneration should be skipped.

		// 3. Update snippet A to be empty (whitespace)
		await settingsPage.startEditingSnippet('A');
		await settingsPage.fillSnippetForm('A', '   ');
		await settingsPage.saveSnippet();

		// 4. Assert that snippet B's content has been cleared.
		await settingsPage.expectGeneratedSnippetContent('B', '');

		// 5. Verify no unexpected API calls were made
		chatMocker.verifyComplete();
	});
});