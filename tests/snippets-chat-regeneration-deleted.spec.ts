import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import { OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB, expect, mockGlobalApis } from './test-helpers';
import { DBV3_ChatSession } from '@/types/storage';
import { ROUTES } from '@/utils/routes';

test.describe('Chat Regeneration with Deleted Snippets', () => {
    let chatPage: ChatPage;
    let chatMocker: ChatCompletionMocker;

    test.describe('when a referenced snippet is deleted', () => {
        test.beforeEach(async ({ context, page, expectedConsoleErrors }) => {
            expectedConsoleErrors.push(/\[resolveSnippets\] Snippet not found: @greet/);
            await mockGlobalApis(context);

            // This session references a snippet named 'greet', but we will NOT seed
            // that snippet into the database.
            const SESSION_WITH_SNIPPET: DBV3_ChatSession = {
                session_id: 'session-with-snippet',
                name: null,
                messages: [
                    {
                        id: 'msg1',
                        role: 'user' as const,
                        content: 'Hello world', // Resolved content
                        raw_content: '@greet world', // Original user input
                        prompt_name: null,
                        model_name: null,
                        cost: null,
                    },
                    {
                        id: 'msg2',
                        role: 'assistant' as const,
                        content: 'Initial response',
                        model_name: 'google/gemini-2.5-pro',
                        prompt_name: null,
                        cost: null,
                        raw_content: undefined,
                    },
                ],
                created_at_ms: 1000,
                updated_at_ms: 1000,
            };

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
                // Intentionally seeding an empty snippets array
                snippets: [],
                chat_sessions: [SESSION_WITH_SNIPPET],
            });
            
            chatPage = new ChatPage(page);
            chatMocker = new ChatCompletionMocker(page);
            await chatMocker.setup();
            
            await page.goto(ROUTES.chat.session(SESSION_WITH_SNIPPET.session_id));
        });

        test('blocks regeneration and shows an error', async () => {
            // Purpose: This test ensures that if a chat message refers to a snippet that has been
            // deleted, the user is prevented from regenerating the assistant's response. It
            // verifies that an appropriate error message is displayed and no API call is made.
            // 1. Verify initial state
            await chatPage.expectMessage(0, 'user', /@greet world/);
            await chatPage.expectMessage(1, 'assistant', /Initial response/);
            
            // 2. Attempt to regenerate
            await chatPage.regenerateMessage(1);

            // 3. Assert that an error is shown
            await expect(chatPage.errorMessage).toContainText("Snippet '@greet' not found.");

            // 4. Assert that the chat history has not changed
            await chatPage.expectMessageCount(2);
            await chatPage.expectMessage(0, 'user', /@greet world/);
            await chatPage.expectMessage(1, 'assistant', /Initial response/);
            
            // 5. Verify no API calls were made for the regeneration
            chatMocker.verifyComplete();
        });
    });
});
