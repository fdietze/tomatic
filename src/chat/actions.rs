
use futures_channel::oneshot;
use leptos::html;
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos::logging::log;
use uuid::Uuid;

use crate::chat::handle_llm_request;
use crate::chat::types::{Message, SystemPrompt};
use crate::llm::{self, DisplayModelInfo};
use crate::GlobalState;

pub fn submit_action(
    prompt_override: Option<String>,
    input: Signal<String>,
    set_input: WriteSignal<String>,
    current_model_name: Memo<String>,
    state: GlobalState,
    set_cancel_sender: WriteSignal<Option<oneshot::Sender<()>>>,
    set_input_disabled: WriteSignal<bool>,
    set_error: WriteSignal<Option<String>>,
    selected_prompt: Memo<Option<SystemPrompt>>,
    set_messages: WriteSignal<Vec<Message>>,
    ref_history: NodeRef<html::Custom<&'static str>>,
    api_key: Signal<String>,
    messages: Signal<Vec<Message>>,
    cached_models: Signal<Vec<DisplayModelInfo>>,
    ref_input: NodeRef<html::Textarea>,
) {
    let content = prompt_override.unwrap_or_else(|| input.get());
    if content.is_empty() {
        return;
    }

    let prepare_messages = async move {
        if state.current_session_id.get().is_none() {
            let new_id = Uuid::new_v4().to_string();
            state.current_session_id.set(Some(new_id.clone()));
            state.navigation_request.set(Some(format!("/chat/{new_id}")));
        }

        let user_message = Message {
            role: "user".to_string(),
            content,
            prompt_name: None,
            model_name: None,
            cost: None,
        };

        set_input.set("".to_string());

        let mut new_messages = Vec::new();

        // Only add a system prompt if this is the first message in the chat.
        if messages.get().is_empty() {
            if let Some(prompt) = selected_prompt.get() {
                let system_message = Message {
                    role: "system".to_string(),
                    content: prompt.prompt.clone(),
                    prompt_name: Some(prompt.name.clone()),
                    model_name: None,
                    cost: None,
                };
                new_messages.push(system_message);
            }
        }

        new_messages.push(user_message);

        set_messages.update(|m| m.extend(new_messages));

        if let Some(ref_history) = ref_history.get() {
            log!("scrolling");
            ref_history.set_scroll_top(ref_history.scroll_height());
        }
    };

    let post_hook = move || {
        if let Some(ref_input) = ref_input.get() {
            println!("focus");
            let _ = ref_input.focus();
        }
    };

    execute_llm_request(
        move || prepare_messages,
        post_hook,
        current_model_name,
        set_cancel_sender,
        set_input_disabled,
        set_error,
        set_messages,
        api_key,
        messages,
        cached_models,
    );
}

pub fn regenerate_action(
    index: usize,
    current_model_name: Memo<String>,
    set_cancel_sender: WriteSignal<Option<oneshot::Sender<()>>>,
    set_input_disabled: WriteSignal<bool>,
    set_error: WriteSignal<Option<String>>,
    set_messages: WriteSignal<Vec<Message>>,
    api_key: Signal<String>,
    messages: Signal<Vec<Message>>,
    cached_models: Signal<Vec<DisplayModelInfo>>,
) {
    let prepare_messages = async move {
        set_messages.update(|m| {
            m.drain(index..);
        });
    };

    let post_hook = || {};

    execute_llm_request(
        move || prepare_messages,
        post_hook,
        current_model_name,
        set_cancel_sender,
        set_input_disabled,
        set_error,
        set_messages,
        api_key,
        messages,
        cached_models,
    );
}

#[allow(clippy::too_many_arguments)]
fn execute_llm_request<F, Fut>(
    prepare_messages: F,
    post_hook: impl FnOnce() + 'static,
    current_model_name: Memo<String>,
    set_cancel_sender: WriteSignal<Option<oneshot::Sender<()>>>,
    set_input_disabled: WriteSignal<bool>,
    set_error: WriteSignal<Option<String>>,
    set_messages: WriteSignal<Vec<Message>>,
    api_key: Signal<String>,
    messages: Signal<Vec<Message>>,
    cached_models: Signal<Vec<DisplayModelInfo>>,
) where
    F: FnOnce() -> Fut + 'static,
    Fut: std::future::Future<Output = ()> + 'static,
{
    let model = llm::Model {
        model: current_model_name(),
        seed: None,
        temperature: Some(1.0),
    };

    spawn_local(async move {
        prepare_messages().await;

        let (tx, rx) = oneshot::channel();
        set_cancel_sender.set(Some(tx));
        set_input_disabled.set(true);
        set_error(None);

        if api_key().is_empty() {
            set_error.set(Some(
                "No API key provided. Please add one in Settings.".to_string(),
            ));
        } else {

            handle_llm_request(
                messages(),
                model,
                api_key(),
                set_messages,
                set_error,
                cached_models,
                current_model_name(),
                rx,
            )
            .await;
        }

        set_input_disabled.set(false);
        set_cancel_sender.set(None);
        post_hook();
    });
}

