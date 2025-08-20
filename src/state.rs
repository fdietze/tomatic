use leptos::prelude::*;
use crate::chat::types::{Message, SystemPrompt};
use crate::llm::DisplayModelInfo;

#[derive(Clone)]
pub struct GlobalState {
    // App-wide state
    pub api_key: Signal<String>,
    pub set_api_key: WriteSignal<String>,
    pub system_prompts: Signal<Vec<SystemPrompt>>,
    pub set_system_prompts: WriteSignal<Vec<SystemPrompt>>,
    pub model_name: Signal<String>,
    pub set_model_name: WriteSignal<String>,
    pub input: Signal<String>,
    pub set_input: WriteSignal<String>,
    pub cached_models: Signal<Vec<DisplayModelInfo>>,
    pub set_cached_models: WriteSignal<Vec<DisplayModelInfo>>,
    // Current session state
    pub messages: RwSignal<Vec<Message>>,
    pub selected_prompt_name: RwSignal<Option<String>>,
    pub error: RwSignal<Option<String>>,
    pub current_session_id: RwSignal<Option<String>>,
    // Request from child to parent
    pub session_load_request: WriteSignal<Option<String>>,
    pub navigation_request: RwSignal<Option<String>>,
    pub initial_chat_prompt: RwSignal<Option<String>>,
}
