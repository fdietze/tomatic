import OpenAI from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { z } from 'zod';

import type { DisplayModelInfo } from '@/types/storage';
import type { Message } from '@/types/chat';
import type { ModelInfo, GenerationStats } from '@/types/openrouter';

// --- Zod Schemas for Runtime Validation ---

// Schema for the full, rich ModelInfo object from the API
const modelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  context_length: z.number(),
  created: z.number().optional(),
  canonical_slug: z.string().nullable().optional(),
  hugging_face_id: z.string().nullable().optional(),
  architecture: z.object({
    modality: z.string(),
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
    tokenizer: z.string(),
    instruct_type: z.string().nullable(),
  }),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
    request: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    web_search: z.string().optional().nullable(),
    internal_reasoning: z.string().optional().nullable(),
    input_cache_read: z.string().optional().nullable(),
    input_cache_write: z.string().optional().nullable(),
  }),
  top_provider: z.object({
    context_length: z.number().nullable(),
    max_completion_tokens: z.number().nullable(),
    is_moderated: z.boolean(),
  }),
  per_request_limits: z.unknown().nullable().optional(),
  supported_parameters: z.array(z.string()).nullable().optional(),
});

// Zod schema for the entire API response
const apiModelsResponseSchema = z.object({
    data: z.array(modelInfoSchema),
});


// Helper to safely parse price strings and convert to cost per million tokens
const parsePriceToPerMillion = (priceStr: string): number | null => {
    const price = parseFloat(priceStr);
    return isNaN(price) ? null : price * 1_000_000;
}

// --- API Client Configuration ---

const getOpenAIClient = (apiKey: string) => {
  if (!apiKey) {
    throw new Error('OpenRouter API key is missing.');
  }
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: apiKey,
    // Recommended headers to identify your app to OpenRouter.
    defaultHeaders: {
      'HTTP-Referer': window.location.host,
      'X-Title': 'Tomatic',
    },
    dangerouslyAllowBrowser: true,
  });
};

// --- API Functions ---

export async function listAvailableModels(): Promise<DisplayModelInfo[]> {
  // We are not using the OpenAI client here because this is an OpenRouter-specific endpoint.
  // The official OpenAI client does not have a `models.list()` equivalent that works for OpenRouter's model discovery.
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch models: ${response.status} ${errorText}`);
    }
    const jsonResponse = await response.json();
    
    // Validate the structure of the full API response.
    const validation = apiModelsResponseSchema.safeParse(jsonResponse);
    if (!validation.success) {
      console.error('[API] Zod validation failed for model list:', validation.error);
      throw new Error('Received invalid data structure for model list.');
    }

    // Map the full, validated ModelInfo into the simpler DisplayModelInfo for the UI
    return validation.data.data.map((model: ModelInfo) => ({
        id: model.id,
        name: model.name,
        prompt_cost_usd_pm: parsePriceToPerMillion(model.pricing.prompt),
        completion_cost_usd_pm: parsePriceToPerMillion(model.pricing.completion),
    }));

  } catch (error) {
    console.error('[API] listAvailableModels error:', error);
    throw error; // Re-throw to be handled by the caller
  }
}

export async function streamChatCompletion(
  messages: Message[],
  model: string,
  apiKey: string
): Promise<{ stream: AsyncGenerator<ChatCompletionChunk, void, unknown>; id: string }> {
  try {
    const openai = getOpenAIClient(apiKey);

    const openAiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const rawStream = await openai.chat.completions.create({
      model: model,
      messages: openAiMessages,
      stream: true,
    });

    // We need to extract the ID from the first chunk without consuming the stream
    // for the caller. We can do this by creating a new async generator.
    const iterator = rawStream[Symbol.asyncIterator]();
    const firstResult = await iterator.next();

    if (firstResult.done) {
      throw new Error('Stream was empty, no ID could be determined.');
    }

    const firstChunk = firstResult.value;
    const generationId = firstChunk.id;

    async function* newStream(): AsyncGenerator<ChatCompletionChunk, void, unknown> {
      // Yield the first chunk that we've already read
      yield firstChunk;
      // Now, yield the rest of the original stream
      yield* {
        [Symbol.asyncIterator]: () => iterator,
      };
    }

    return { stream: newStream(), id: generationId };
  } catch (error) {
    console.error('[API] streamChatCompletion error:', error);
    throw error;
  }
}

export async function getGenerationStats(apiKey: string, generationId: string): Promise<GenerationStats | null> {
  // According to OpenRouter docs, it can take some time for stats to be available.
  // We will retry a few times with a delay.
  const MAX_RETRIES = 4;
  const RETRY_DELAY_MS = 500;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 404 && i < MAX_RETRIES - 1) {
        // Generation not found yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (i + 1)));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch generation stats: ${response.status} ${errorText}`);
      }

      const jsonResponse = await response.json();
      const stats = jsonResponse.data;

      return {
        cost: stats.cost,
        native_tokens_prompt: stats.native_tokens_prompt,
        native_tokens_completion: stats.native_tokens_completion,
      };

    } catch (error) {
      // If it's the last retry and it still fails, we log it but don't re-throw,
      // as failing to get the cost shouldn't break the chat flow.
      if (i === MAX_RETRIES - 1) {
        console.error(`[API] getGenerationStats failed after ${MAX_RETRIES} retries for id ${generationId}:`, error);
        return null;
      }
    }
  }

  return null; // Should be unreachable, but here for safety
}
