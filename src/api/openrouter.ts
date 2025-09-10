import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { z } from 'zod';

import type { DisplayModelInfo } from '@/types/storage';
import type { Message } from '@/types/chat';
import type { ModelInfo } from '@/types/openrouter';

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
  console.debug('[API|listAvailableModels] Fetching from https://openrouter.ai/api/v1/models');
  // We are not using the OpenAI client here because this is an OpenRouter-specific endpoint.
  // The official OpenAI client does not have a `models.list()` equivalent that works for OpenRouter's model discovery.
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch models: ${String(response.status)} ${errorText}`);
    }
    const jsonResponse = await response.json() as unknown;
    
    // Validate the structure of the full API response.
    const validation = apiModelsResponseSchema.safeParse(jsonResponse);
    if (!validation.success) {
      console.error('[API] Zod validation failed for model list:', validation.error.format());
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[API] listAvailableModels error: ${errorMessage}`);
    // Re-throw a more specific error to be handled by the caller in the store.
    throw new Error(`[API] listAvailableModels error: ${errorMessage}`);
  }
}

export async function requestMessageContentStreamed(
  messages: Message[],
  model: string,
  apiKey: string
): Promise<Stream<ChatCompletionChunk>> {
  try {
    const openai = getOpenAIClient(apiKey);
    
    // Map our internal Message type to the type expected by the OpenAI client.
    const openAiMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    console.debug(
      `[API] Requesting chat completion with model ${model} and ${String(openAiMessages.length)} messages.`
    );
    const stream = await openai.chat.completions.create({
      model: model,
      messages: openAiMessages,
      stream: true,
    });
    
    return stream;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[API] requestMessageContentStreamed error: ${errorMessage}`);
    throw new Error(`[API] requestMessageContentStreamed error: ${errorMessage}`);
  }
}
