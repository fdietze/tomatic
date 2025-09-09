// Types that mirror the full, rich response from the OpenRouter /models endpoint.

export interface ArchitectureDetails {
  modality: string;
  input_modalities: string[];
  output_modalities: string[];
  tokenizer: string;
  instruct_type: string | null;
}

export interface PricingInfo {
  prompt: string;
  completion: string;
  request?: string | null;
  image?: string | null;
  web_search?: string | null;
  internal_reasoning?: string | null;
  input_cache_read?: string | null;
  input_cache_write?: string | null;
}

export interface TopProviderInfo {
  context_length: number | null;
  max_completion_tokens: number | null;
  is_moderated: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string | null;
  context_length: number;
  created?: number;
  canonical_slug?: string | null;
  hugging_face_id?: string | null;
  architecture: ArchitectureDetails;
  pricing: PricingInfo;
  top_provider: TopProviderInfo;
  per_request_limits?: unknown | null;
  supported_parameters?: string[] | null;
}

export interface GenerationStats {
  cost: number;
  native_tokens_prompt: number;
  native_tokens_completion: number;
}
