import type { BrowserContext } from "@playwright/test";
import { Buffer } from "buffer";

// Allow re-exporting expect
import { expect } from "@playwright/test";

// A mock response for the /models endpoint
export const MOCK_MODELS_RESPONSE = {
  data: [
    {
      id: "openai/gpt-4o",
      name: "OpenAI: GPT-4o",
      description: "GPT-4o is OpenAI's most advanced model.",
      context_length: 128000,
      created: 1677652288,
      canonical_slug: "openai/gpt-4o-2024-05-13",
      hugging_face_id: "",
      architecture: {
        modality: "text+image->text",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        tokenizer: "OpenAI",
        instruct_type: "openai",
      },
      pricing: {
        prompt: "0.000005",
        completion: "0.000015",
        request: "0",
        image: "0",
        web_search: "0",
        internal_reasoning: "0",
      },
      top_provider: {
        context_length: 128000,
        max_completion_tokens: 4096,
        is_moderated: true,
      },
      per_request_limits: null,
      supported_parameters: ["tools", "tool_choice", "max_tokens"],
    },
    {
      id: "mock-model/mock-model",
      name: "Mock Model",
      description: "A mock model for testing purposes.",
      context_length: 4096,
      created: 1677652288,
      canonical_slug: "mock-model/mock-model",
      hugging_face_id: "",
      architecture: {
        modality: "text->text",
        input_modalities: ["text"],
        output_modalities: ["text"],
        tokenizer: "Mock",
        instruct_type: "mock",
      },
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        request: "0",
        image: "0",
        web_search: "0",
        internal_reasoning: "0",
      },
      top_provider: {
        context_length: 4096,
        max_completion_tokens: 1024,
        is_moderated: false,
      },
      per_request_limits: null,
      supported_parameters: ["max_tokens"],
    },
  ],
};

export const OPENROUTER_API_KEY = "TEST_API_KEY";

export const DEFAULT_LOCAL_STORAGE = {
  state: {
    apiKey: OPENROUTER_API_KEY,
    modelName: "openai/gpt-4o",
    autoScrollEnabled: true,
    selectedPromptName: null,
    initialChatPrompt: null,
    loading: "idle",
    saving: "idle",
  },
  version: 1,
};

/**
 * Mocks the global /models API endpoint.
 * This is a common requirement for almost all tests.
 */
export async function mockGlobalApis(context: BrowserContext): Promise<void> {
  // Mock the /models endpoint
  await context.route("https://openrouter.ai/api/v1/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
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
export function createStreamResponse(
  model: string,
  content: string,
  role: "assistant",
): Buffer {
  const streamData = [
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{"role":"${role}","content":""},"finish_reason":null}]}`,
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{"content":"${content}"},"finish_reason":null}]}`,
    `{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"${model}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  ];
  const responseString =
    streamData.map((line) => `data: ${line}\n\n`).join("") + "data: [DONE]\n\n";
  return Buffer.from(responseString);
}

/**
 * Creates a Buffer that simulates a standard (non-streaming) API response from the /chat/completions endpoint.
 * @param model The model name to include in the response.
 * @param content The text content of the response.
 * @returns A Buffer object with the simulated JSON data.
 */
export function createChatCompletionResponse(
  model: string,
  content: string,
  role: "assistant",
): Buffer {
  const responseObject = {
    id: "chatcmpl-123",
    object: "chat.completion",
    created: 1677652300,
    model: model,
    choices: [
      {
        index: 0,
        message: {
          role: role,
          content: content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 9,
      total_tokens: 17,
    },
  };
  return Buffer.from(JSON.stringify(responseObject));
}

export { expect };
import type { ChatSession } from "../src/types/chat";
import type {
  Snippet,
  SystemPrompt,
  LocalStorageV1State,
  IndexedDBDataCurrent,
} from "../src/types/storage";

interface InjectedState {
  localStorage: Record<string, string>;
  indexedDB: {
    dbName: string;
    version: number;
    stores: {
      storeName: string;
      keyPath: string;
      indexes?: {
        name: string;
        keyPath: string;
        options?: IDBIndexParameters;
      }[];
      data: (ChatSession | SystemPrompt | Snippet)[];
    }[];
  };
}

/**
 * Injects strongly-typed data into IndexedDB.
 */
export async function seedIndexedDB(
  context: BrowserContext,
  data: Partial<IndexedDBDataCurrent>,
) {
  const injectedState: InjectedState = {
    localStorage: {},
    indexedDB: {
      dbName: "tomatic_chat_db",
      version: 3,
      stores: [
        {
          storeName: "chat_sessions",
          keyPath: "session_id",
          indexes: [{ name: "updated_at_ms", keyPath: "updated_at_ms" }],
          data: (data.chat_sessions || []) as ChatSession[],
        },
        {
          storeName: "system_prompts",
          keyPath: "name",
          data: data.system_prompts || [],
        },
        {
          storeName: "snippets",
          keyPath: "name",
          data: data.snippets || [],
        },
      ],
    },
  };

  // This script runs in the browser context
  await context.addInitScript((state: InjectedState) => {
    // 2. Populate IndexedDB
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(
        state.indexedDB.dbName,
        state.indexedDB.version,
      );

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
            store = db.createObjectStore(storeInfo.storeName, {
              keyPath: storeInfo.keyPath,
            });
          }

          storeInfo.indexes?.forEach((index) => {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, index.keyPath, index.options);
            }
          });
        });
      };

      request.onerror = () => {
        reject(
          new Error(`IndexedDB error: ${request.error?.message ?? "Unknown"}`),
        );
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (state.indexedDB.stores.every((s) => s.data.length === 0)) {
          db.close();
          resolve();
          return;
        }

        const storeNames = state.indexedDB.stores.map((s) => s.storeName);
        const tx = db.transaction(storeNames, "readwrite");
        const promises: Promise<unknown>[] = [];

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          reject(
            new Error(`Transaction error: ${tx.error?.message ?? "Unknown"}`),
          );
        };

        state.indexedDB.stores.forEach((storeInfo) => {
          console.log(`[DEBUG] Seeding store: ${storeInfo.storeName} with ${storeInfo.data.length} items`);
          if (storeInfo.data.length > 0) {
            const store = tx.objectStore(storeInfo.storeName);
            storeInfo.data.forEach((item, index) => {
              console.log(`[DEBUG] Seeding item ${index} in ${storeInfo.storeName}:`, item);
              promises.push(
                new Promise((resolvePut, rejectPut) => {
                  const putRequest = store.put(item);
                  putRequest.onsuccess = () => {
                    console.log(`[DEBUG] Successfully seeded item ${index} in ${storeInfo.storeName}`);
                    resolvePut(putRequest.result);
                  };
                  putRequest.onerror = () => {
                    console.log(`[DEBUG] Failed to seed item ${index} in ${storeInfo.storeName}:`, putRequest.error);
                    rejectPut(new Error(putRequest.error?.message));
                  };
                }),
              );
            });
          }
        });

        Promise.all(promises).catch((err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      };
    });
  }, injectedState);
}
/**
 * Injects a strongly-typed object into localStorage under the 'tomatic-storage' key.
 */
export async function seedLocalStorage(
  context: BrowserContext,
  data: { state?: Partial<LocalStorageV1State>; version?: number },
) {
  const finalData = {
    ...DEFAULT_LOCAL_STORAGE,
    ...data,
    state: {
      ...DEFAULT_LOCAL_STORAGE.state,
      ...data.state,
    },
  };
  await context.addInitScript((data) => {
    window.localStorage.setItem("tomatic-storage", JSON.stringify(data));
  }, finalData);
}

import type { Page, Route } from "@playwright/test";

// --- Chat Completion Mocking Utilities ---

export interface ChatMessageMock {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequestMock {
  model: string;
  messages: ChatMessageMock[];
  stream: boolean; // Add stream property
}

export interface ChatCompletionResponseMock {
  role: "assistant";
  content: string;
  error?: {
    status: number;
    message: string;
  };
}

export interface MockedChatCompletion {
  request: ChatCompletionRequestMock;
  response: ChatCompletionResponseMock;
  manualTrigger?: boolean;
}

/**
 * A class to manage mocking chat completion API calls in Playwright tests.
 * It allows defining specific request/response mocks for each test, ensuring
 * that tests are self-contained and deterministic.
 */
export class ChatCompletionMocker {
  private mocks: MockedChatCompletion[] = [];
  private page: Page;
  private pendingTriggers: (() => void)[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  async setup() {
    await this.page.route(
      "https://openrouter.ai/api/v1/chat/completions",
      (route) => this.handleRequest(route),
    );
  }

  /**
   * Registers a new mock for a chat completion request.
   * @param mock The mock definition, including the request to match and the response to serve.
   */
  mock(mock: MockedChatCompletion) {
    this.mocks.push(mock);
  }

  getPendingMocks() {
    return this.mocks;
  }

  private async handleRequest(route: Route) {
    const requestBody = (await route
      .request()
      .postDataJSON()) as ChatCompletionRequestMock;

    console.log("[DEBUG] ChatCompletionMocker: received request:", JSON.stringify(requestBody, null, 2));
    console.log("[DEBUG] ChatCompletionMocker: available mocks:", this.mocks.length);

    // Find a matching mock without removing it yet
    let mockIndex = -1;
    for (let i = 0; i < this.mocks.length; i++) {
      const m = this.mocks[i];
      if (!m) continue;

      let isMatch = true;

      if (m.request.model !== requestBody.model) {
        isMatch = false;
      }

      const mockStream = m.request.stream === true;
      const requestStream = requestBody.stream === true;
      if (mockStream !== requestStream) {
        isMatch = false;
      }

      if (m.request.messages.length !== requestBody.messages.length) {
        isMatch = false;
      }

      if (isMatch) {
        for (let j = 0; j < m.request.messages.length; j++) {
          const mockMsg = m.request.messages[j];
          const reqMsg = requestBody.messages[j];
          if (!reqMsg || !mockMsg) {
            isMatch = false;
            break;
          }
          if (mockMsg.role !== reqMsg.role) {
            isMatch = false;
          }
          if (mockMsg.content !== reqMsg.content) {
            isMatch = false;
          }
        }
      }

      if (isMatch) {
        mockIndex = i;
        break; // Found a match, stop searching
      } else {
      }
    }

    if (mockIndex === -1) {
      console.error(
        `[ChatCompletionMocker] Unexpected API call. No mock found for request:`,
        JSON.stringify(requestBody, null, 2),
      );
      console.error(
        `[ChatCompletionMocker] Available mocks:`,
        JSON.stringify(this.mocks, null, 2),
      );
      const errorMessage = `[ChatCompletionMocker] Unexpected API call to /chat/completions. No matching mock found.\nRECEIVED:\n${JSON.stringify(
        requestBody,
        null,
        2,
      )}\n\nAVAILABLE MOCKS:\n${JSON.stringify(this.mocks, null, 2)}`;
      throw new Error(errorMessage);
    }

    // Remove the matched mock from the queue
    const nextMock = this.mocks.splice(mockIndex, 1)[0];

    if (!nextMock) {
      throw new Error(
        `[ChatCompletionMocker] Mock not found after splice, this should not happen.`,
      );
    }

    if (nextMock.manualTrigger) {
      const triggerPromise = new Promise<void>((resolve) => {
        this.pendingTriggers.push(resolve);
      });
      await triggerPromise;
    }

    if (nextMock.response.error) {
      const errorBody = {
        error: {
          message: nextMock.response.error.message,
          type: "invalid_request_error", // A common error type
          param: null,
          code: "invalid_request_error",
        },
      };
      await route.fulfill({
        status: nextMock.response.error.status,
        contentType: "application/json",
        body: JSON.stringify(errorBody),
      });
    } else {
      const isStreaming = requestBody.stream === true;
      console.log(`[DEBUG] ChatCompletionMocker: generating response, isStreaming: ${isStreaming}, content: "${nextMock.response.content}"`);

      const responseBody = isStreaming
        ? createStreamResponse(
          requestBody.model,
          nextMock.response.content,
          nextMock.response.role,
        )
        : createChatCompletionResponse(
          requestBody.model,
          nextMock.response.content,
          nextMock.response.role,
        );

      console.log(`[DEBUG] ChatCompletionMocker: fulfilling response with ${isStreaming ? 'streaming' : 'non-streaming'} body`);
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: responseBody,
      });
      console.log(`[DEBUG] ChatCompletionMocker: response fulfilled successfully`);
    }
  }

  /**
   * Resolves the next pending chat completion that was created with `manualTrigger: true`.
   * This is the "trigger" that the test can call.
   */
  async resolveNextCompletion() {
    console.log("[DEBUG] resolveNextCompletion called, pending triggers:", this.pendingTriggers.length);
    if (this.pendingTriggers.length === 0) {
      // It's possible this is called before the app has had time to make the request.
      // Give it a very short moment to see if a trigger appears.
      console.log("[DEBUG] No pending triggers, waiting 100ms");
      await this.page.waitForTimeout(100);
    }
    if (this.pendingTriggers.length === 0) {
      console.error("[ChatCompletionMocker] No pending triggers found.");
      throw new Error(
        "[ChatCompletionMocker] No pending chat completions to resolve.",
      );
    }
    const trigger = this.pendingTriggers.shift();
    if (trigger) {
      trigger();
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
        this.mocks.length,
      )} mock(s) were not consumed.\n\nUNCONSUMED MOCKS:\n${JSON.stringify(this.mocks, null, 2)}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

/**
 * Waits for a custom event to be dispatched on the window object.
 */
export async function waitForEvent(
  page: Page,
  eventName: string,
  timeout = 5000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const eventFound = await page.evaluate<boolean, string>((name) => {
      return window.app_events.some((e) => e.type === name);
    }, eventName);

    if (eventFound) {
      return;
    }
    await page.waitForTimeout(100); // Poll every 100ms
  }
  throw new Error(`Timed out waiting for event "${eventName}"`);
}

/**
 * A more robust way to wait for snippet regeneration to complete.
 * It listens for the custom 'app:snippet:regeneration:complete' event.
 * @param page The Playwright Page object.
 * @param snippetName The name of the snippet to wait for.
 * @param timeout The maximum time to wait in milliseconds.
 */
export async function waitForSnippetRegeneration(
  page: Page,
  snippetName: string,
  timeout = 10000,
): Promise<void> {
  await page.evaluate(
    ({ name, timeout: t }) => {
      return new Promise<void>((resolve, reject) => {
        const handler = (event: Event) => {
          const customEvent = event as CustomEvent;
          if (customEvent.detail.name === name) {
            window.removeEventListener(
              "app:snippet:regeneration:complete",
              handler,
            );
            clearTimeout(timeoutId);
            resolve();
          }
        };

        const timeoutId = setTimeout(() => {
          window.removeEventListener(
            "app:snippet:regeneration:complete",
            handler,
          );
          reject(
            new Error(
              `Timed out after ${t}ms waiting for snippet '${name}' to regenerate.`,
            ),
          );
        }, t);

        window.addEventListener("app:snippet:regeneration:complete", handler);
      });
    },
    { name: snippetName, timeout },
  );
}
