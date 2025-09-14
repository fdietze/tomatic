import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { ChatPage } from './pom/ChatPage';
import { OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB, expect, mockGlobalApis } from './test-helpers';
import { DBV3_Snippet, DBV3_ChatSession } from '@/types/storage';

test.describe('Chat Regeneration with Deleted Snippets', () => {
    let settingsPage: SettingsPage;
    let chatPage: ChatPage;
    let chatMocker: ChatCompletionMocker;

    test.describe('blocks regeneration and shows an error if a referenced snippet was deleted', () => {
        test.use({ expectedConsoleErrors: [/\[resolveSnippets\] Snippet not found: @greet/] });
        
        test.beforeEach(async ({ context, page }) => {
            await mockGlobalApis(context);

            const MOCK_SNIPPET: DBV3_Snippet = {
                name: 'greet',
                content: 'Hello',
                isGenerated: false,
                createdAt_ms: 0,
                updatedAt_ms: 0,
                generationError: null,
                isDirty: false,
            };

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
                snippets: [MOCK_SNIPPET],
                chat_sessions: [SESSION_WITH_SNIPPET],
            });
            
            chatPage = new ChatPage(page);
            settingsPage = new SettingsPage(page);
            chatMocker = new ChatCompletionMocker(page);
            await chatMocker.setup();
            
            await page.goto(`/chat/${SESSION_WITH_SNIPPET.session_id}`);
        });

        test('shows an error and does not regenerate', async ({
            page,
        }) => {
            // 1. Verify initial state
            await chatPage.expectMessage(0, 'user', /@greet world/);
            await chatPage.expectMessage(1, 'assistant', /Initial response/);

            // 2. Go to settings and delete the snippet
            await chatPage.navigation.goToSettings();
            await settingsPage.deleteSnippet('greet');
            await settingsPage.expectSnippetToNotExist('greet');

            // 3. Go back to the chat
            await settingsPage.navigation.goBackToChat();
            await page.waitForURL(`**/chat/session-with-snippet`);
            
            // 4. Attempt to regenerate
            await chatPage.regenerateMessage(1);

            // 5. Assert that an error is shown
            await expect(chatPage.errorMessage).toContainText("Snippet '@greet' not found.");

            // 6. Assert that the chat history has not changed
            await chatPage.expectMessageCount(2);
            await chatPage.expectMessage(0, 'user', /@greet world/);
            await chatPage.expectMessage(1, 'assistant', /Initial response/);
            
            // 7. Verify no API calls were made for the regeneration
            chatMocker.verifyComplete();
        });
    });
});
