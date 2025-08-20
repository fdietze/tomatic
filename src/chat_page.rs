use leptos::prelude::*;
use leptos_router::hooks::{use_params_map, use_query_map};

use crate::chat::ChatInterface;
use crate::state::GlobalState;
#[component]
pub fn ChatPage() -> impl IntoView {
    let params = use_params_map();
    let query = use_query_map();
    let state = use_context::<GlobalState>().expect("GlobalState context not found");

    // When the :id parameter in the URL changes, send a request to the parent App to load the session

    Effect::new(move |_| {
        let id = params.with(|p| p.get("id").map(|s| s.to_owned()).unwrap_or_default());
        leptos::logging::log!("[DEBUG] [ChatPage] URL parameter 'id' changed to: '{}'.", &id);

        if id == "new" {
            if let Some(prompt_from_q) = query.with(|q| q.get("q").map(|s| s.to_owned())) {
                if !prompt_from_q.is_empty() {
                    leptos::logging::log!("[DEBUG] [ChatPage] Found 'q' parameter, setting initial prompt.");
                    state.initial_chat_prompt.set(Some(prompt_from_q));
                }
            }
        }
        leptos::logging::log!("[DEBUG] [ChatPage] Requesting session load for id: '{}'.", &id);
        state.session_load_request.set(Some(id));
    });

    view! {
        <ChatInterface
            messages=state.messages.read_only()
            set_messages=state.messages.write_only()
            system_prompts=state.system_prompts
            selected_prompt_name=state.selected_prompt_name.read_only()
            set_selected_prompt_name=state.selected_prompt_name.write_only()
            error=state.error.read_only()
            set_error=state.error.write_only()
            api_key=state.api_key
            model_name=state.model_name
            set_model_name=state.set_model_name
            input=state.input
            set_input=state.set_input
            cached_models=state.cached_models
            set_cached_models=state.set_cached_models
            initial_chat_prompt=state.initial_chat_prompt
        />
    }
}