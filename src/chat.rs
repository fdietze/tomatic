pub mod request;
pub use request::handle_llm_request;
pub mod message;
pub mod types;
pub use message::ChatMessage;
pub mod controls;
pub use controls::ChatControls;
pub mod system_prompt_bar;
use futures_channel::oneshot;
use leptos::logging::log;
use leptos::{html, prelude::*, task::spawn_local};
use std::sync::Arc;
pub use system_prompt_bar::SystemPromptBar;
pub use types::{Message, SystemPrompt};
use uuid::Uuid;

use crate::combobox::{Combobox, ComboboxItem};
use crate::llm::{self, DisplayModelInfo};
use crate::GlobalState;

fn extract_mentioned_prompt(input: &str, system_prompts: &[SystemPrompt]) -> Option<SystemPrompt> {
    input
        .split_whitespace()
        .filter_map(|word| {
            if let Some(name) = word.strip_prefix('@') {
                let name = name.trim_matches(|c: char| !c.is_alphanumeric());
                system_prompts.iter().find(|sp| sp.name == name).cloned()
            } else {
                None
            }
        })
        .next()
}

#[component]
pub fn ChatInterface(
    #[prop(into)] messages: Signal<Vec<Message>>,
    #[prop(into)] set_messages: WriteSignal<Vec<Message>>,
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] selected_prompt_name: Signal<Option<String>>,
    #[prop(into)] set_selected_prompt_name: WriteSignal<Option<String>>,
    #[prop(into)] error: Signal<Option<String>>,
    #[prop(into)] set_error: WriteSignal<Option<String>>,
    #[prop(into)] api_key: Signal<String>,
    #[prop(into)] model_name: Signal<String>,
    #[prop(into)] set_model_name: WriteSignal<String>,
    #[prop(into)] input: Signal<String>,
    #[prop(into)] set_input: WriteSignal<String>,
    #[prop(into)] cached_models: Signal<Vec<DisplayModelInfo>>,
    #[prop(into)] set_cached_models: WriteSignal<Vec<DisplayModelInfo>>,
    #[prop(into)] initial_chat_prompt: RwSignal<Option<String>>,
) -> impl IntoView {
    let state = use_context::<GlobalState>().expect("GlobalState context not found");
    leptos::logging::log!(
        "[LOG] [ChatInterface] Component created. Any `use_local_storage` here is risky."
    );
    on_cleanup(|| {
        leptos::logging::log!("[LOG] [ChatInterface] Component cleaned up. If a panic about disposed values follows, it's because a hook from here (like the old `use_local_storage` for input) is being called after cleanup.");
    });

    let (input_disabled, set_input_disabled) = signal(false);
    let (models_loading, set_models_loading) = signal(false);
    let (models_error, set_models_error) = signal::<Option<String>>(None);
    let (_cancel_sender, set_cancel_sender) = signal::<Option<oneshot::Sender<()>>>(None);

    let selected_prompt = Memo::new(move |_| {
        let system_prompts = system_prompts();
        let prompt_name: Option<String> = selected_prompt_name();
        prompt_name
            .and_then(|name| system_prompts.iter().find(|sp| sp.name == name))
            .cloned()
    });

    Effect::new(move |_| {
        let mentioned_prompt = extract_mentioned_prompt(&input(), &system_prompts());
        if let Some(prompt) = mentioned_prompt {
            set_selected_prompt_name(Some(prompt.name.clone()));
        }
    });

    let ref_input: NodeRef<html::Textarea> = NodeRef::new();
    let ref_history: NodeRef<html::Custom<&str>> = NodeRef::new();

    let fetch_models = StoredValue::new(move || {
        let current_api_key = api_key.get_untracked();
        if current_api_key.is_empty() {
            return;
        }

        set_models_loading(true);
        set_models_error(None);
        spawn_local(async move {
            match crate::llm::list_available_models(current_api_key).await {
                Ok(models) => {
                    set_cached_models.set(models);
                }
                Err(e) => {
                    set_models_error(Some(e.to_string()));
                }
            }
            set_models_loading(false);
        });
    });

    Effect::new(move |_| {
        if cached_models.get().is_empty() && !api_key.get().is_empty() {
            fetch_models.get_value()();
        }
    });

    Effect::new(move |_| {
        if api_key.get().is_empty() {
            set_cached_models.set(vec![]);
            set_models_error(None);
        }
    });

    let combobox_items = Memo::new(move |_| {
        cached_models
            .get()
            .into_iter()
            .map(|model_info| {
                let (display_text, display_html) =
                    if let (Some(prompt_cost), Some(completion_cost)) =
                        (model_info.prompt_cost_usd_pm, model_info.completion_cost_usd_pm)
                    {
                        let price_display = format!("in: {prompt_cost: >6.2}$ out: {completion_cost: >6.2}$/MTok");

                        let text = format!(
                            "{} {}",
                            model_info.name, price_display
                        );
                        let html = format!(
                            "<div style='display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 1em;'>\n                                <span style='text-overflow: ellipsis; white-space: nowrap; overflow: hidden;'>{}</span>\n                                <span class='model-price' style='flex-shrink: 0; white-space: pre'>{}</span>\n                            </div>",
                            model_info.name, &price_display
                        );
                        (text, Some(html))
                    } else {
                        let text = format!("{} (ID: {})", model_info.name, model_info.id);
                        (text, None)
                    };
                ComboboxItem { id: model_info.id.clone(), display_text, display_html }
            })
            .collect::<Vec<ComboboxItem>>()
    });

    let combobox_external_error = Memo::new(move |_| {
        if api_key.get().is_empty() {
            Some("API key required in Settings to use models.".to_string())
        } else if let Some(e) = models_error.get() {
            Some(format!("Failed to load models: {e}"))
        } else if cached_models.get().is_empty() && !models_loading.get() {
            Some("No models found. Try reloading.".to_string())
        } else {
            None
        }
    });

    Effect::new(move |_| {
        if let Some(ref_input) = ref_input.get() {
            let _ = ref_input.focus();
        }
    });

    let current_model_name = Memo::new(move |_| {
        let name = model_name();
        if name.is_empty() {
            "openai/gpt-4o".to_string()
        } else {
            name
        }
    });

    let submit = Callback::new(move |prompt_override: Option<String>| {
        let content = prompt_override.unwrap_or_else(|| input.get());
        if content.is_empty() {
            return;
        }

        let model = llm::Model {
            model: current_model_name.get(),
            seed: None,
            temperature: Some(1.0),
        };
        let state = state.clone();
        spawn_local(async move {
            // If this is a new chat, generate a new ID and navigate
            if state.current_session_id.get().is_none() {
                let new_id = Uuid::new_v4().to_string();
                state.current_session_id.set(Some(new_id.clone()));
                state
                    .navigation_request
                    .set(Some(format!("/chat/{new_id}")));
            }

            let (tx, rx) = oneshot::channel();
            set_cancel_sender.set(Some(tx));
            set_input_disabled.set(true);
            set_error.set(None);
            let system_prompt_content = selected_prompt
                .get()
                .map(|sp| sp.prompt)
                .unwrap_or("".to_string());

            let user_message = Message {
                role: "user".to_string(),
                content,
                prompt_name: None,
                system_prompt_content: None,
                model_name: None,
                cost: None,
            };

            set_input.set("".to_string());
            set_messages.update(|m| m.push(user_message.clone()));

            if let Some(ref_history) = ref_history.get() {
                log!("scrolling");
                ref_history.set_scroll_top(ref_history.scroll_height());
            }

            if api_key.get().is_empty() {
                set_error.set(Some(
                    "No API key provided. Please add one in Settings.".to_string(),
                ));
            } else {
                let mut messages_to_submit = Vec::new();
                if !system_prompt_content.is_empty() {
                    messages_to_submit.push(Message {
                        role: "system".to_string(),
                        content: system_prompt_content,
                        prompt_name: selected_prompt.get().map(|sp| sp.name.clone()),
                        system_prompt_content: selected_prompt.get().map(|sp| sp.prompt.clone()),
                        model_name: Some(current_model_name.get()),
                        cost: None,
                    });
                }
                messages_to_submit.extend(messages.get());

                handle_llm_request(
                    messages_to_submit,
                    model,
                    api_key.get(),
                    set_messages,
                    set_error,
                    cached_models,
                    current_model_name.get(),
                    selected_prompt,
                    rx,
                )
                .await;
            }

            set_input_disabled.set(false);
            set_cancel_sender.set(None);

            if let Some(ref_input) = ref_input.get() {
                println!("focus");
                let _ = ref_input.focus();
            }
        })
    });

    let regenerate = {
        Arc::new(move |index: usize| {
            let model = llm::Model {
                model: current_model_name(),
                seed: None,
                temperature: Some(1.0),
            };
            spawn_local(async move {
                let (tx, rx) = oneshot::channel();
                set_cancel_sender.set(Some(tx));
                set_input_disabled.set(true);
                set_error(None);

                set_messages.update(|m| {
                    m.drain(index..);
                });

                let system_prompt_content = selected_prompt()
                    .map(|sp| sp.prompt)
                    .unwrap_or("".to_string());

                if api_key().is_empty() {
                    set_error.set(Some(
                        "No API key provided. Please add one in Settings.".to_string(),
                    ));
                } else {
                    let mut messages_to_submit = Vec::new();
                    if !system_prompt_content.is_empty() {
                        messages_to_submit.push(Message {
                            role: "system".to_string(),
                            content: system_prompt_content,
                            prompt_name: selected_prompt.get().map(|sp| sp.name.clone()),
                            system_prompt_content: selected_prompt
                                .get()
                                .map(|sp| sp.prompt.clone()),
                            model_name: Some(current_model_name()),
                            cost: None,
                        });
                    }
                    messages_to_submit.extend(messages());

                    handle_llm_request(
                        messages_to_submit,
                        model,
                        api_key(),
                        set_messages,
                        set_error,
                        cached_models,
                        current_model_name(),
                        selected_prompt,
                        rx,
                    )
                    .await;
                }

                set_input_disabled.set(false);
                set_cancel_sender.set(None);
            })
        })
    };

    let cancel_action = Callback::new(move |_| {
        set_cancel_sender.update(|sender_opt| {
            if let Some(sender) = sender_opt.take() {
                let _ = sender.send(());
            }
        });
    });

    let submit_for_effect = submit;
    Effect::new(move |_| {
        if let Some(prompt) = initial_chat_prompt.get() {
            if messages.get().is_empty() && !input_disabled.get() {
                set_input.set(prompt.clone());
                submit_for_effect.run(Some(prompt));
                initial_chat_prompt.set(None);
            }
        }
    });

    let regenerate_for_messages = regenerate.clone();
    view! {
        <chat-interface>
            <chat-history node_ref=ref_history>
                <div style="display: flex; align-items: center; gap: 4px; padding: 4px; border-bottom: 1px solid var(--border-color); background-color: var(--background-secondary-color); position: relative; z-index: 10;">
                    <div style="flex-grow: 1;">
                        <Combobox
                            items=combobox_items
                            selected_id=model_name
                            on_select=Callback::new(move |id_str: String| {
                                set_model_name.set(id_str)
                            })
                            placeholder="Select or type model ID (e.g. openai/gpt-4o)".to_string()
                            loading=models_loading
                            error_message=combobox_external_error
                            disabled=Signal::derive(move || api_key.get().is_empty())
                        />
                    </div>
                    <button
                        data-size="compact"
                        on:click=move |_| fetch_models.get_value()()
                        disabled=models_loading
                        title="Reload model list"
                    >
                        "reload"
                    </button>
                </div>
                {move || {
                    selected_prompt()
                        .map(|system_prompt| {
                            let system_message_for_render = Message {
                                role: "system".to_string(),
                                content: system_prompt.prompt,
                                prompt_name: Some(system_prompt.name),
                                system_prompt_content: None,
                                model_name: None,
                                cost: None,
                            };
                            view! {
                                <ChatMessage
                                    message=system_message_for_render
                                    set_messages=set_messages
                                    message_index=0_usize
                                    regenerate=regenerate.clone()
                                />
                            }
                        })
                }}
                {move || {
                    messages()
                        .into_iter()
                        .enumerate()
                        .map(|(message_index, message)| {
                            view! {
                                <ChatMessage
                                    message=message
                                    set_messages
                                    message_index
                                    regenerate=regenerate_for_messages.clone()
                                />
                            }
                        })
                        .collect_view()
                }}
                {move || {
                    error()
                        .map(|error| {
                            view! {
                                <error-box>
                                    <div style="font-weight: bold">"error"</div>
                                    {error}
                                </error-box>
                            }
                        })
                }}
            </chat-history>
            <ChatControls
                input=input
                set_input=set_input
                input_disabled=input_disabled
                ref_input=ref_input
                submit=submit
                cancel_action=cancel_action
            />
        </chat-interface>
    }
}
