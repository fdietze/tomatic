import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB } from './test-helpers';

test.describe('Automatic Regeneration Edge Cases', () => {
	let settingsPage: SettingsPage;
	// let chatMocker: ChatCompletionMocker;

	test.use({ expectedConsoleErrors: [/Internal Server Error/, /Generation failed/] });

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
		await seedIndexedDB(context, {
			snippets: [],
		});

		settingsPage = new SettingsPage(page);
		// chatMocker = new ChatCompletionMocker(page);
		// await chatMocker.setup();
		await settingsPage.goto();
	});

	test.describe('halts regeneration when an update introduces a cycle', () => {
		test.use({ expectedConsoleErrors: [/\[validateSnippetDependencies\] Cycle detected/] });
		test('halts regeneration', async ({ page }) => {
			const chatMocker = new ChatCompletionMocker(page);
			await chatMocker.setup();
			chatMocker.mock({ // Initial generation of B
				request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] },
				response: { role: 'assistant', content: 'Content of B from v1' },
			});
			chatMocker.mock({ // Initial generation of C
				request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for C using Content of B from v1' }] },
				response: { role: 'assistant', content: 'Content of C from B_v1' },
			});
			await settingsPage.createNewSnippet('A', 'v1');
			await settingsPage.createGeneratedSnippet('B', 'Prompt for B using @A', 'mock-model/mock-model', 'Mock Model');
			await settingsPage.createGeneratedSnippet('C', 'Prompt for C using @B', 'mock-model/mock-model', 'Mock Model');
			await expect(settingsPage.getSnippetItem('B')).toBeVisible();
			await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v1/);
			await expect(settingsPage.getSnippetItem('C')).toBeVisible();
			await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);
			await settingsPage.startEditingSnippet('A');
			await settingsPage.fillSnippetForm('A', 'v2 referencing @C');
			await settingsPage.saveSnippet();
			await settingsPage.page.waitForTimeout(500);
			await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v1/);
			await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);
			chatMocker.verifyComplete();
		});
	});

	test.describe('propagates failures transitively during regeneration', () => {
		test.use({
			expectedConsoleErrors: [/Failed to load resource.*500/],
		});
		test('propagates failures transitively', async ({ page }) => {
			const chatMocker = new ChatCompletionMocker(page);
			await chatMocker.setup();

			// Mocks for successful initial creation & regeneration
			chatMocker.mock({ request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] }, response: { role: 'assistant', content: 'Content of B from v1' } });
			chatMocker.mock({ request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for C using Content of B from v1' }] }, response: { role: 'assistant', content: 'Content of C from B_v1' } });
			
			await settingsPage.createNewSnippet('A', 'v1');
			await settingsPage.createGeneratedSnippet('B', 'Prompt for B using @A', 'mock-model/mock-model', 'Mock Model');
			await settingsPage.createGeneratedSnippet('C', 'Prompt for C using @B', 'mock-model/mock-model', 'Mock Model');
			
			await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v1/);
			await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);
			
			chatMocker.mock({
				request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v2' }] },
				response: {
					role: 'assistant',
					content: '', // Not used
					error: { status: 500, message: 'Internal Server Error' },
				},
				manualTrigger: true,
			});
			
			await settingsPage.startEditingSnippet('A');
			await settingsPage.fillSnippetForm('A', 'v2');
			await settingsPage.saveSnippet();
			
			const snippetB = settingsPage.getSnippetItem('B');
			const snippetC = settingsPage.getSnippetItem('C');

			// Wait for B to start regenerating, then trigger the mock failure
			await expect(snippetB.getByTestId('regenerating-spinner')).toBeVisible();
			await chatMocker.resolveNextCompletion();

			// Wait for B to finish regenerating (it will show an error)
			await expect(snippetB.getByTestId('regenerating-spinner')).not.toBeVisible();
			await expect(snippetB.getByTestId('generation-error-message')).toHaveText('Generation failed: 500 Internal Server Error');

			// Now wait for C to start and finish its regeneration, which should also fail
			// We expect the spinner to appear, even if briefly.
			await expect.poll(async () => snippetC.getByTestId('regenerating-spinner').isVisible(), { timeout: 1000 }).toBe(false);
			
			// Assert the final state of C
			await expect(snippetC.getByTestId('generation-error-message')).toHaveText('Generation failed: Upstream dependency @B failed to generate.');
			await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);
			
			chatMocker.verifyComplete();
		});
	});
});
