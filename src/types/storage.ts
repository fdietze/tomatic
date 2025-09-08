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
