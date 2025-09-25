import OpenAI, { APIError } from "openai";
import type { Stream } from "openai/streaming";
import { z } from "zod";

import type { DisplayModelInfo } from "@/types/storage";
import type { Message } from "@/types/chat";
import type { ModelInfo } from "@/types/openrouter";
import { createAppError } from "@/types/errors";

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
};

// --- API Client Configuration ---

const getOpenAIClient = (apiKey: string): OpenAI => {
  if (!apiKey) {
    throw createAppError.authentication("OpenRouter API key is missing.");
  }
  const maxRetries = window.__IS_TESTING__ ? 0 : 2;
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: apiKey,
    // Disable retries for deterministic test behavior.
    maxRetries: maxRetries,
    // Recommended headers to identify your app to OpenRouter.
    defaultHeaders: {
      "HTTP-Referer": window.location.host,
      "X-Title": "Tomatic",
    },
    dangerouslyAllowBrowser: true,
  });
};

// --- API Functions ---

export async function listAvailableModels(): Promise<DisplayModelInfo[]> {
  // We are not using the OpenAI client here because this is an OpenRouter-specific endpoint.
  // The official OpenAI client does not have a `models.list()` equivalent that works for OpenRouter's model discovery.
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok) {
      const errorText = await response.text();
      throw createAppError.api(
        `Failed to fetch models: ${errorText}`,
        response.status,
        "https://openrouter.ai/api/v1/models"
      );
    }
    const jsonResponse = (await response.json()) as unknown;

    // Validate the structure of the full API response.
    const validation = apiModelsResponseSchema.safeParse(jsonResponse);
    if (!validation.success) {
      console.error(
        "[API] Zod validation failed for model list:",
        validation.error.format(),
      );
      throw createAppError.validation("api_response", "Received invalid data structure for model list.");
    }

    // Map the full, validated ModelInfo into the simpler DisplayModelInfo for the UI
    return validation.data.data.map((model: ModelInfo) => ({
      id: model.id,
      name: model.name,
      prompt_cost_usd_pm: parsePriceToPerMillion(model.pricing.prompt),
      completion_cost_usd_pm: parsePriceToPerMillion(model.pricing.completion),
    }));
  } catch (error) {
    // If it's already an AppError, re-throw it
    if (error && typeof error === 'object' && 'type' in error) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw createAppError.api(`listAvailableModels error: ${errorMessage}`);
  }
}

export async function requestMessageContentStream(
  messages: Message[],
  model: string,
  apiKey: string,
): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const body = {
    model: model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const openai = getOpenAIClient(apiKey);

  try {
    return await openai.chat.completions.create({
      model: body.model,
      messages: body.messages,
      stream: true,
    });
  } catch (e) {
    if (e instanceof APIError) {
      throw createAppError.api(e.message, e.status, "chat.completions.create");
    }
    throw createAppError.unknown("An unknown error occurred while fetching the model response.", e);
  }
}

export async function requestMessageContent(
  messages: Message[],
  model: string,
  apiKey: string,
): Promise<string> {
  const body = {
    model: model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const openai = getOpenAIClient(apiKey);

  try {
    const completion = await openai.chat.completions.create({
      model: body.model,
      messages: body.messages,
      stream: false,
    });
    return completion.choices[0]?.message?.content ?? "";
  } catch (e) {
    if (e instanceof APIError) {
      throw createAppError.api(e.message, e.status, "chat.completions.create");
    }
    throw createAppError.unknown("An unknown error occurred while fetching the model response.", e);
  }
}
