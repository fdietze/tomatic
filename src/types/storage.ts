export interface SystemPrompt {
  name: string;
  prompt: string;
}

export interface DisplayModelInfo {
  id: string;
  name: string;
  prompt_cost_usd_pm: number | null;
  completion_cost_usd_pm: number | null;
}

export interface Snippet {
  name: string;
  content: string;
  isGenerated: boolean; // Must be a required boolean
  prompt?: string;
  model?: string;
  createdAt_ms: number;
  updatedAt_ms: number;
  generationError: string | null;
  isDirty: boolean;
}
