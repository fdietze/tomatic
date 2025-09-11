import type { BrowserContext } from '@playwright/test';
import { Buffer } from 'buffer';

// Allow re-exporting expect
import { expect } from '@playwright/test';

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

export const OPENROUTER_API_KEY = 'TEST_API_KEY';

/**
 * Mocks the global /models API endpoint.
 * This is a common requirement for almost all tests.
 */
export async function mockGlobalApis(context: BrowserContext): Promise<void> {
  // Mock the /models endpoint
  await context.route('https://openrouter.ai/api/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MODELS_RESPONSE),
    });
  });
}

/**
 * Creates a Buffer that simulates a streaming API response from the /chat/completions endpoint.
 * @param model The model name to include in the response.
 * @param content The text content of the response.
 * @returns A Buffer object with the simulated stream data.
 */
export function createStreamResponse(model: string, content: string, role: 'assistant'): Buffer {
  const streamData = [
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{"role":"${role}","content":""},"finish_reason":null}]}`,
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{"content":"${content}"},"finish_reason":null}]}`,
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  ];
  const responseString = streamData.map((line) => `data: ${line}\n\n`).join('') + 'data: [DONE]\n\n';
  return Buffer.from(responseString);
}


export { expect };
import type { ChatSession } from '../src/types/chat';
import type { SystemPrompt } from '../src/types/storage';

interface InjectedState {
  localStorage: Record<string, string>;
  indexedDB: {
    dbName: string;
    version: number;
    stores: {
      storeName: string;
      keyPath: string;
      indexes?: { name: string; keyPath: string; options?: IDBIndexParameters }[];
      data: (ChatSession | SystemPrompt)[];
    }[];
  };
}

/**
 * Injects data into IndexedDB.
 */
export async function seedIndexedDB(context: BrowserContext, data: { chat_sessions?: ChatSession[], system_prompts?: SystemPrompt[] }) {

  const injectedState: InjectedState = {
    localStorage: {},
    indexedDB: {
      dbName: 'tomatic_chat_db',
      version: 2,
      stores: [
        {
          storeName: 'chat_sessions',
          keyPath: 'session_id',
          indexes: [{ name: 'updated_at_ms', keyPath: 'updated_at_ms' }],
          data: data.chat_sessions || [],
        },
        {
          storeName: 'system_prompts',
          keyPath: 'name',
          // Data is empty here because the new implementation uses localStorage for prompts
          // and the DB store is created via migration, which we are simulating.
          data: data.system_prompts || [],
        },
      ],
    },
  };

  // This script runs in the browser context
  await context.addInitScript((state: InjectedState) => {

    // 2. Populate IndexedDB
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(state.indexedDB.dbName, state.indexedDB.version);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        if (!transaction) {
          return; // Should not happen
        }
        state.indexedDB.stores.forEach((storeInfo) => {
          let store: IDBObjectStore;
          if (db.objectStoreNames.contains(storeInfo.storeName)) {
            store = transaction.objectStore(storeInfo.storeName);
          } else {
            store = db.createObjectStore(storeInfo.storeName, { keyPath: storeInfo.keyPath });
          }

          storeInfo.indexes?.forEach((index) => {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, index.keyPath, index.options);
            }
          });
        });
      };

      request.onerror = () => {
        reject(new Error(`IndexedDB error: ${request.error?.message ?? 'Unknown'}`));
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (state.indexedDB.stores.every((s) => s.data.length === 0)) {
          db.close();
          resolve();
          return;
        }

        const storeNames = state.indexedDB.stores.map((s) => s.storeName);
        const tx = db.transaction(storeNames, 'readwrite');

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          reject(new Error(`Transaction error: ${tx.error?.message ?? 'Unknown'}`));
        };

        state.indexedDB.stores.forEach((storeInfo) => {
          if (storeInfo.data.length > 0) {
            const store = tx.objectStore(storeInfo.storeName);
            storeInfo.data.forEach((item) => {
              store.put(item);
            });
          }
        });
      };
    });
  }, injectedState);
}

/**
 * Injects key-value pairs into localStorage.
 */


import type { Page, Route } from '@playwright/test';

// --- Chat Completion Mocking Utilities ---

export interface ChatMessageMock {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequestMock {
  model: string;
  messages: ChatMessageMock[];
}

export interface ChatCompletionResponseMock {
  role: 'assistant';
  content: string;
}

export interface ChatCompletionMock {
  request: ChatCompletionRequestMock;
  response: ChatCompletionResponseMock;
}

/**
 * A class to manage mocking chat completion API calls in Playwright tests.
 * It allows defining specific request/response mocks for each test, ensuring
 * that tests are self-contained and deterministic.
 */
export class ChatCompletionMocker {
  private mocks: ChatCompletionMock[] = [];
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async setup() {
    await this.page.route('https://openrouter.ai/api/v1/chat/completions', this.handleRequest.bind(this));
  }

  /**
   * Registers a new mock for a chat completion request.
   * @param mock The mock definition, including the request to match and the response to serve.
   */
  mock(mock: ChatCompletionMock) {
    this.mocks.push(mock);
  }

   private async handleRequest(route: Route) {
    const requestBody = (await route.request().postDataJSON()) as ChatCompletionRequestMock;
    const nextMock = this.mocks.shift();

    if (!nextMock) {
      const errorMessage = `[ChatCompletionMocker] Unexpected API call to /chat/completions. No more mocks in the queue.\nRECEIVED:\n${JSON.stringify(
        requestBody,
        null,
        2
      )}`;
      throw new Error(errorMessage);
    }

    const modelsMatch = nextMock.request.model === requestBody.model;
    const messagesMatch = JSON.stringify(nextMock.request.messages) === JSON.stringify(requestBody.messages);

    if (modelsMatch && messagesMatch) {
      const responseBody = createStreamResponse(
        requestBody.model,
        nextMock.response.content,
        nextMock.response.role
      );
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: responseBody,
      });
    } else {
      const errorMessage = `[ChatCompletionMocker] API call to /chat/completions did not match the expected request.\n\nEXPECTED:\n${JSON.stringify(
        nextMock.request,
        null,
        2
      )}\n\nRECEIVED:\n${JSON.stringify(requestBody, null, 2)}`;
      // Put the mock back in the queue for better debugging
      this.mocks.unshift(nextMock);
      throw new Error(errorMessage);
    }
   }

  /**
   * Verifies that all registered mocks have been consumed by API calls.
   * Throws an error if any mocks are left in the queue, indicating that
   * the test made fewer API calls than expected.
   */
  verifyComplete() {
    if (this.mocks.length > 0) {
       const errorMessage = `[ChatCompletionMocker] Test completed, but ${String(
        this.mocks.length
       )} mock(s) were not consumed.\n\nUNCONSUMED MOCKS:\n${JSON.stringify(this.mocks, null, 2)}`;
      throw new Error(errorMessage);
    }
   }
}
export async function seedLocalStorage(context: BrowserContext, data: Record<string, object>) {
  await context.addInitScript((data) => {
    for (const [key, value] of Object.entries(data)) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  }, data)
}

