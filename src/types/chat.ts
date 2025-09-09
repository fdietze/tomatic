export interface MessageCost {
  prompt: number;
  completion: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface Message {
  id:string;
  prompt_name?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  imageUrl?: string | null;
  model_name?: string | null;
  cost?: MessageCost | null;
}

export interface ChatSession {
  session_id: string;
  messages: Message[];
  name?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}
