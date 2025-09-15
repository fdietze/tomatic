import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB, waitForEvent } from './test-helpers';

test.describe('Snippet Chat with Regeneration Wait', () => {
    let chatPage: ChatPage;
    let settingsPage: SettingsPage;
    let chatMocker: ChatCompletionMocker;

    test.beforeEach(async ({ context, page }) => {
        await mockGlobalApis(context);
        chatPage = new ChatPage(page);
        settingsPage = new SettingsPage(page);
        chatMocker = new ChatCompletionMocker(page);
        await chatMocker.setup();

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
    });

    test.describe('on successful regeneration', () => {
        test('successfully waits for a snippet to regenerate before sending a message', async ({ page, context }) => {
            // Purpose: This test ensures that if a user tries to send a message containing a snippet
            // that is currently being regenerated, the chat submission will pause and wait for the
            // regeneration to complete successfully before sending the message with the *new* content.
            await seedIndexedDB(context, {
                snippets: [
                    { name: 'A', content: 'v1', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
                    { name: 'B', content: 'Content from A_v1', isGenerated: true, prompt: 'Prompt for B using @A', model: 'mock-model/mock-model', createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true },
                ],
            });

            // Mock B's regeneration, triggered by the app's startup logic for dirty snippets
            chatMocker.mock({
                request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] },
                response: { role: 'assistant', content: 'Content from A_v1_regenerated' },
                manualTrigger: true, // We will control when this finishes
            });

            // Mock B's regeneration AGAIN, because navigating to the settings page also triggers it
            chatMocker.mock({
                request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] },
                response: { role: 'assistant', content: 'Content from A_v1_regenerated' },
                manualTrigger: true,
            });

            // Mock B's regeneration AGAIN, for the third page load (chat -> settings -> chat)
            chatMocker.mock({
                request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] },
                response: { role: 'assistant', content: 'Content from A_v1_regenerated' },
                manualTrigger: true,
            });

            // Mock the final chat message, which should use the *new* content of B
            chatMocker.mock({
                request: { model: 'google/gemini-2.5-pro', messages: [{ role: 'user', content: 'Hello Content from A_v1_regenerated' }] },
                response: { role: 'assistant', content: 'Final response.' },
            });

            await chatPage.goto();

            // Wait for the regeneration process to start (due to B being dirty)
            await waitForEvent(page, 'snippet_regeneration_started');
            // Ensure the regeneration spinner for snippet B is visible on the settings page
            await settingsPage.goto();
            const snippetB = settingsPage.getSnippetItem('B');
            await expect(snippetB.getByTestId('regenerating-spinner')).toBeVisible();

            // Immediately go back to chat and try to send a message that uses B
            await chatPage.goto();
            const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
            await chatPage.sendMessage('Hello @B');

            // Assert that the chat message has NOT been sent yet because we haven't resolved B's regeneration.
            // We can confirm this by checking that its mock is still pending.
            expect(chatMocker.getPendingMocks().length).toBe(1);

            // Now, resolve the pending regenerations for B (one from the initial load, one from settings page, one from final chat page load)
            await chatMocker.resolveNextCompletion();
            await chatMocker.resolveNextCompletion();
            await chatMocker.resolveNextCompletion();

            // The chat message should now be sent automatically
            await responsePromise;

            // Verify the final state
            await chatPage.expectMessage(0, 'user', /Hello @B/);
            await chatPage.expectMessage(1, 'assistant', /Final response/);
            chatMocker.verifyComplete();
        });
    });

    test.describe('on failed regeneration', () => {
        test('aborts message sending', async ({ page, context, expectedConsoleErrors }) => {
            expectedConsoleErrors.push(/Failed to load resource.*500/, /Internal Server Error/);
            
            // Purpose: This test ensures that if a user's message depends on a snippet that fails
            // to regenerate, the message submission is aborted and a clear error is shown to the user.
            await seedIndexedDB(context, {
                snippets: [
                    { name: 'A', content: 'v1', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
                    { name: 'B', content: 'Content from A_v1', isGenerated: true, prompt: 'Prompt for B using @A', model: 'mock-model/mock-model', createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true },
                ],
            });
            
            // We ONLY mock the regeneration, which is expected to fail.
            // We DO NOT mock a chat completion. If the app tries to send one, the test will fail.
            chatMocker.mock({
                request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'Prompt for B using v1' }] },
                response: {
                    role: 'assistant',
                    content: '', // Not used
                    error: { status: 500, message: 'Internal Server Error' },
                },
                manualTrigger: true,
            });

            await chatPage.goto();
            
            await waitForEvent(page, 'snippet_regeneration_started');
            
            await chatPage.sendMessage('Hello @B');

            // Resolve the regeneration mock, causing it to fail
            await chatMocker.resolveNextCompletion();

            // Assert the error is visible in the UI
            await expect(chatPage.errorMessage).toBeVisible();
            await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
                "Snippet '@B' failed to regenerate: 500 Internal Server Error"
            );
            await chatPage.expectMessageCount(0);
            // Verify that only the single regeneration mock was consumed.
            chatMocker.verifyComplete();
        });
    });
});
