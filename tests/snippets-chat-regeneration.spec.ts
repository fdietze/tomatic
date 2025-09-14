import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { ChatPage } from './pom/ChatPage';
import { OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB, expect } from './test-helpers';
import { DBV3_Snippet, DBV3_ChatSession } from '@/types/storage';

test.describe('Chat Regeneration with Snippets', () => {
let settingsPage: SettingsPage;
let chatPage: ChatPage;
let chatMocker: ChatCompletionMocker;

test('uses updated snippet content when regenerating a response', async ({
context,
page,
}) => {
// 1. Define Mock Data
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
content: 'Hello world',
raw_content: '@greet world',
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

// 2. Seed Data and Mock APIs
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
// Wait for the UI to confirm the save is complete to avoid a race condition
await expect(settingsPage.getSnippetEditContainer('greet')).not.toBeVisible();
await expect(settingsPage.getSnippetItem('greet')).toBeVisible();

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