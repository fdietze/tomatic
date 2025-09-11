import { test as base, expect, BrowserContext } from '@playwright/test';
import { Buffer } from 'buffer';
import { SettingsPage } from './pom/SettingsPage';
import type { SystemPrompt } from '../src/types/storage';

import { ChatPage } from './pom/ChatPage';

import type { ChatSession } from '@/types/chat';

// We are extending the base test with custom fixtures.
// https://playwright.dev/docs/test-fixtures
type TestFixtures = {
  chatPageWithHistory: ChatPage;
  settingsPageWithPrompts: SettingsPage;
  chatPageWithPrompt: ChatPage;
  newChatPage: ChatPage;
};

// By convention, we extend the Window object with custom properties for test-specific flags.
declare global {
  interface Window {
    _chatSessionsSeeded?: boolean;
    _localStorageSeeded?: boolean;
  }
}
const OPENROUTER_API_KEY = 'TEST_API_KEY';

// A mock response for the /models endpoint
export const MOCK_MODELS_RESPONSE = {
  data: [
    {
      id: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      description: "GPT-4o is OpenAI's most advanced model.",
      context_length: 128000,
      created: 1677652288,
      canonical_slug: 'openai/gpt-4o-2024-05-13',
      hugging_face_id: '',
      architecture: {
        modality: 'text+image->text',
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        tokenizer: 'OpenAI',
        instruct_type: 'openai',
      },
      pricing: {
        prompt: '0.000005',
        completion: '0.000015',
        request: '0',
        image: '0',
        web_search: '0',
        internal_reasoning: '0',
      },
      top_provider: {
        context_length: 128000,
        max_completion_tokens: 4096,
        is_moderated: true,
      },
      per_request_limits: null,
      supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
    },
    {
      id: 'mock-model/mock-model',
      name: 'Mock Model',
      description: 'A mock model for testing purposes.',
      context_length: 4096,
      created: 1677652288,
      canonical_slug: 'mock-model/mock-model',
      hugging_face_id: '',
      architecture: {
        modality: 'text->text',
        input_modalities: ['text'],
        output_modalities: ['text'],
        tokenizer: 'Mock',
        instruct_type: 'mock',
      },
      pricing: {
        prompt: '0.000001',
        completion: '0.000002',
        request: '0',
        image: '0',
        web_search: '0',
        internal_reasoning: '0',
      },
      top_provider: {
        context_length: 4096,
        max_completion_tokens: 1024,
        is_moderated: false,
      },
      per_request_limits: null,
      supported_parameters: ['max_tokens'],
    },
  ],
};


// A function to set up common API mocks
export async function mockApis(context: BrowserContext): Promise<void> {
  console.debug('[TEST|mockApis] Setting up API mocks.');
  // Mock the /models endpoint
  await context.route('https://openrouter.ai/api/v1/models', async (route) => {
    console.debug('[TEST|mockApis] Fulfilling request to /api/v1/models.');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MODELS_RESPONSE),
    });
  });
}


// Extend basic test by providing a page fixture that logs all console messages.
export const test = base.extend<TestFixtures>({
  context: async ({ browser }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },

  page: async ({ page }, use, testInfo) => {
    // Set mock API key before navigating
    await page.addInitScript((apiKey) => {
      const persistedState = {
        state: { apiKey },
        version: 0,
      };
      window.localStorage.setItem('tomatic-storage', JSON.stringify(persistedState));
      console.debug('[TEST] Mock API key set in local storage.');
    }, OPENROUTER_API_KEY);

    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      const msgType = msg.type().toUpperCase();
      const msgText = msg.text();

      if (msgType === 'ERROR') {
        // Fail the test if a console error occurs
        throw new Error(`[BROWSER CONSOLE ERROR]: ${msgText}`);
      }

      // Filter out noisy Vite HMR messages for cleaner test logs
      if (
        msgText.startsWith('[vite]') ||
        msgText.includes('Download the React DevTools for a better development experience')
      ) {
        return;
      }
      consoleMessages.push(`[BROWSER CONSOLE|${msgType}]: ${msgText}`);
    });

    await use(page);

    if (testInfo.status !== testInfo.expectedStatus) {
      console.debug(`[TEST FAILED]: ${testInfo.title}`);
      console.debug('[BROWSER CONSOLE LOGS]:');
      consoleMessages.forEach((msg) => {
        console.debug(msg);
      });
    }
  },

   chatPageWithHistory: async ({ context, page }, use) => {
    // 1. Define Mock Data
    const sessions: ChatSession[] = [
      {
        session_id: 'session-old',
        messages: [{ id: 'msg1', role: 'user', content: 'Old message' }],
        created_at_ms: 1000,
        updated_at_ms: 1000,
        prompt_name: null,
      },
      {
        session_id: 'session-middle',
        messages: [{ id: 'msg2', role: 'user', content: 'Middle message' }],
        created_at_ms: 2000,
        updated_at_ms: 2000,
        prompt_name: null,
      },
      {
        session_id: 'session-new',
        messages: [{ id: 'msg3', role: 'user', content: 'New message' }],
        created_at_ms: 3000,
        updated_at_ms: 3000,
        prompt_name: null,
      },
    ];

    // 2. Seed Data and Mock APIs
    await seedChatSessions(context, sessions);
    await mockApis(context);

    // 3. Navigate to the starting page
    await page.goto('/chat/session-new');

    // 4. Provide the POM to the test
    const chatPage = new ChatPage(page);
    await use(chatPage);
   },

   settingsPageWithPrompts: async ({ context, page }, use) => {
    // 1. Define Mock Data
    const MOCK_PROMPTS: SystemPrompt[] = [
      { name: 'Chef', prompt: 'You are a master chef.' },
      { name: 'Pirate', prompt: 'You are a fearsome pirate.' },
    ];

    // 2. Seed Data (in old format) and Mock APIs
    await mockApis(context);
    await page.addInitScript((prompts) => {
      const persistedState = {
        state: {
          systemPrompts: prompts, // Old format
          apiKey: 'TEST_API_KEY',
        },
        version: 0, // Trigger migration
      };
      window.localStorage.setItem('tomatic-storage', JSON.stringify(persistedState));
    }, MOCK_PROMPTS);

    // 3. Navigate to the starting page
    const settingsPage = new SettingsPage(page);
    await settingsPage.goto();

    // 4. Provide the POM to the test
    await use(settingsPage);
  },

  chatPageWithPrompt: async ({ context, page }, use) => {
    // 1. Define Mock Data
    const MOCK_PROMPTS: SystemPrompt[] = [
      { name: 'Chef', prompt: 'You are a master chef.' },
      { name: 'Pirate', prompt: 'You are a fearsome pirate.' },
    ];
    const SESSION_WITH_PROMPT: ChatSession = {
      session_id: 'session-with-prompt',
      messages: [
        { id: 'msg1', role: 'system', content: 'You are a master chef.', prompt_name: 'Chef' },
        { id: 'msg2', role: 'user', content: 'Hello chef' },
        { id: 'msg3', role: 'assistant', content: 'Hello there!', model_name: 'openai/gpt-4o' },
      ],
      created_at_ms: 1000,
      updated_at_ms: 1000,
    };

    // 2. Seed Data and Mock APIs
    await mockApis(context);
    await context.addInitScript((prompts) => {
      if (window._localStorageSeeded) return;
      const persistedState = {
        state: {
          systemPrompts: prompts,
          apiKey: 'TEST_API_KEY',
        },
        version: 0,
      };
      window.localStorage.setItem('tomatic-storage', JSON.stringify(persistedState));
      window._localStorageSeeded = true;
    }, MOCK_PROMPTS);

    await seedChatSessions(context, [SESSION_WITH_PROMPT]);

    // 3. Navigate to the starting page
    await page.goto(`/chat/${SESSION_WITH_PROMPT.session_id}`);

    // 4. Provide the POM to the test
    const chatPage = new ChatPage(page);
    await use(chatPage);
  }, 

  newChatPage: async ({ context, page }, use) => {
    // 1. Mock APIs
    await mockApis(context);

    // 2. Navigate to the starting page
    const chatPage = new ChatPage(page);
    await chatPage.gotoNewChat();

    // 3. Provide the POM to the test
    await use(chatPage);
  },
});

export function createStreamResponse(model: string, content: string): Buffer {
  const streamData = [
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{"content":"${content}"},"finish_reason":null}]}`,
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  ];
  const responseString = streamData.map((line) => `data: ${line}\n\n`).join('') + 'data: [DONE]\n\n';
  return Buffer.from(responseString);
}


/**
 * Seeds the IndexedDB `chat_sessions` object store with mock data.
 * This runs in a browser context via `addInitScript`.
 *
 * @param context The Playwright browser context.
 * @param sessions An array of chat sessions to seed.
 */
export async function seedChatSessions(context: BrowserContext, sessions: ChatSession[]) {
  await context.addInitScript((mockSessions) => {
    // This guard prevents a test from re-seeding if it navigates to a new page.
    if (window._chatSessionsSeeded) return;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('tomatic_chat_db', 2);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('chat_sessions')) {
          const store = db.createObjectStore('chat_sessions', { keyPath: 'session_id' });
          store.createIndex('updated_at_ms', 'updated_at_ms');
        }
        if (!db.objectStoreNames.contains('system_prompts')) {
          db.createObjectStore('system_prompts', { keyPath: 'name' });
        }
      };

      request.onerror = () => {
        reject(new Error(`IndexedDB error: ${request.error?.message ?? 'Unknown'}`));
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (mockSessions.length === 0) {
          db.close();
          resolve();
          return;
        }

        const tx = db.transaction('chat_sessions', 'readwrite');
        const store = tx.objectStore('chat_sessions');
        mockSessions.forEach((session) => store.put(session));

        tx.oncomplete = () => {
          db.close();
          window._chatSessionsSeeded = true;
          resolve();
        };

        tx.onerror = () => {
          reject(new Error(`Transaction error: ${tx.error?.message ?? 'Unknown'}`));
        };
      };
    });
  }, sessions);
}
export { expect };
