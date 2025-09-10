import { test as base, expect, BrowserContext } from '@playwright/test';
import { Buffer } from 'buffer';

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
export const test = base.extend({
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

export { expect };
