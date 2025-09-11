export interface SystemPrompt {
  name:string;
  prompt: string;
}

export interface Snippet {
  name: string;
  content: string;
  isGenerated: boolean;
  prompt?: string;
  model?: string;
}

export interface DisplayModelInfo {
  id: string;
  name: string;
  prompt_cost_usd_pm: number | null;
  completion_cost_usd_pm: number | null;
}
