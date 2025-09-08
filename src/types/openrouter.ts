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
  architecture: ArchitectureDetails;
  pricing: PricingInfo;
  top_provider: TopProviderInfo;
}
