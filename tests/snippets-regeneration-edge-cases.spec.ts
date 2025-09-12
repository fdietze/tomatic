import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker } from './test-helpers';

test.describe('Automatic Regeneration Edge Cases', () => {
	let settingsPage: SettingsPage;
	let chatMocker: ChatCompletionMocker;

	test.use({ expectedConsoleErrors: [/Internal Server Error/, /Generation failed/] });

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

	test('halts regeneration when an update introduces a cycle', async () => {
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
		await expect(settingsPage.getSnippetItem('B')).toBeVisible();
		await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v1/);
		await expect(settingsPage.getSnippetItem('C')).toBeVisible();
		await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);

        // 4. Introduce the cycle by editing A to reference C
        await settingsPage.startEditingSnippet('A');
        await settingsPage.fillSnippetForm('A', 'v2 referencing @C');
        
        // No new API calls should be made, so no new mocks are needed.
        
        await settingsPage.saveSnippet();

        // 5. Assertions
        // Give a moment for any async regeneration process to potentially (and incorrectly) start
        await settingsPage.page.waitForTimeout(500);

        // The content should NOT have changed because the regeneration should have been aborted
        await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v1/);
        await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);

        // Verify that no unexpected API calls were made after the cycle was introduced.
        // The initial mocks for creating B and C should be consumed, but nothing more.
        chatMocker.verifyComplete();
	});

	test('propagates failures transitively during regeneration', async ({ page }) => {
		// This route handler will run before the global ChatCompletionMocker's handler
		await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
			const requestBody = await route.request().postDataJSON();
			// We only want to intercept the regeneration of B
			if (requestBody.messages[0].content === 'Prompt for B using v2') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: { message: 'Internal Server Error' } }),
				});
			} else {
				// For all other calls (initial generation of B and C), let the default mocker handle it.
				void route.continue();
			}
		});

		// 1. Set up mocks for the initial, successful creation of B and C
		chatMocker.mock({ request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] }, response: { role: 'assistant', content: 'Content of B from v1' } });
		chatMocker.mock({ request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for C using Content of B from v1' }] }, response: { role: 'assistant', content: 'Content of C from B_v1' } });

		// 2. Create the snippet chain: C -> B -> A
		await settingsPage.createNewSnippet('A', 'v1');
		await settingsPage.createGeneratedSnippet('B', 'Prompt for B using @A', 'mock-model/mock-model', 'Mock Model');
		await settingsPage.createGeneratedSnippet('C', 'Prompt for C using @B', 'mock-model/mock-model', 'Mock Model');

		// 3. Verify initial state
		await settingsPage.expectGeneratedSnippetContent('B', /Content of B from v1/);
		await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);

		// 4. Update snippet A, which should trigger the chain reaction
		await settingsPage.startEditingSnippet('A');
		await settingsPage.fillSnippetForm('A', 'v2');
		await settingsPage.saveSnippet();

		// 5. Assert that B shows a failure and C shows an upstream failure
		await expect(settingsPage.getSnippetItem('B').getByTestId('generation-error-message')).toHaveText(/Generation failed: Internal Server Error/);
		await expect(settingsPage.getSnippetItem('C').getByTestId('generation-error-message')).toHaveText(/Upstream dependency @B failed to generate/);

		// 6. C's content should not have changed
		await settingsPage.expectGeneratedSnippetContent('C', /Content of C from B_v1/);

		// 7. Verify all initial mocks were consumed. The regeneration of B was intercepted by our
		// manual route handler, and C was never regenerated.
		chatMocker.verifyComplete();
	});
});
