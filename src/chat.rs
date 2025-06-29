use futures::{pin_mut, StreamExt};
use leptos::logging::log;
use leptos::{html, prelude::*, task::spawn_local};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::combobox::{Combobox, ComboboxItem};
use crate::copy_button::CopyButton;
use crate::dom_utils;
use crate::llm::{self, DisplayModelInfo, StreamedMessage};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SystemPrompt {
    pub name: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct MessageCost {
    pub prompt: f64,
    pub completion: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    prompt_name: Option<String>,
    role: String,
    content: String,
    model_name: Option<String>,
    system_prompt_content: Option<String>,
    cost: Option<MessageCost>,
}

impl Message {
    fn to_llm(&self) -> llm::Message {
        llm::Message {
            role: self.role.clone(),
            content: self.content.clone(),
        }
    }
}

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

async fn handle_llm_request(
    messages_to_submit: Vec<Message>,
    model: llm::Model,
    api_key: String,
    set_messages: WriteSignal<Vec<Message>>,
    set_error: WriteSignal<Option<String>>,
    cached_models: Signal<Vec<DisplayModelInfo>>,
    current_model_name: String,
    selected_prompt: Memo<Option<SystemPrompt>>,
) {
    let response_message = Message {
        role: "assistant".to_string(),
        content: String::new(),
        prompt_name: selected_prompt.get().map(|sp| sp.name.clone()),
        system_prompt_content: selected_prompt.get().map(|sp| sp.prompt.clone()),
        model_name: Some(current_model_name.clone()),
        cost: None,
    };
    set_messages.update(|m| m.push(response_message));

    match llm::request_message_content_streamed(
        messages_to_submit.iter().map(|m| m.to_llm()).collect(),
        model,
        api_key,
    )
    .await
    {
        Ok(stream) => {
            let mut accumulated_content = String::new();
            pin_mut!(stream);

            let mut buffer = String::new();
            // Using Option to handle the first update immediately.
            let mut last_update_time: Option<f64> = None;
            const THROTTLE_MS: f64 = 200.0;
            let performance = window().performance().expect("performance should be available");

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(streamed_message) => match streamed_message {
                        StreamedMessage::Content(content) => {
                            buffer.push_str(&content);
                            let now = performance.now();
                            let should_update = if let Some(last_time) = last_update_time {
                                now - last_time > THROTTLE_MS
                            } else {
                                true // First chunk, update immediately
                            };

                            if should_update {
                                accumulated_content.push_str(&buffer);
                                buffer.clear();
                                set_messages.update(|m| {
                                    if let Some(last) = m.last_mut() {
                                        last.content = accumulated_content.clone();
                                    }
                                });
                                last_update_time = Some(now);
                            }
                        }
                        StreamedMessage::Usage(usage) => {
                            // Flush any remaining content before processing usage
                            if !buffer.is_empty() {
                                accumulated_content.push_str(&buffer);
                                buffer.clear();
                                set_messages.update(|m| {
                                    if let Some(last) = m.last_mut() {
                                        last.content = accumulated_content.clone();
                                    }
                                });
                            }

                            let model_info = cached_models
                                .get()
                                .into_iter()
                                .find(|m| m.id == current_model_name);
                            if let Some(model_info) = model_info {
                                let prompt_cost =
                                    model_info.prompt_cost_usd_pm.unwrap_or(0.0)
                                        * usage.prompt_tokens as f64
                                        / 1_000_000.0;
                                let completion_cost = model_info
                                    .completion_cost_usd_pm
                                    .unwrap_or(0.0)
                                    * usage.completion_tokens as f64
                                    / 1_000_000.0;
                                set_messages.update(|m| {
                                    if let Some(last) = m.last_mut() {
                                        last.cost = Some(MessageCost {
                                            prompt: prompt_cost,
                                            completion: completion_cost,
                                        });
                                    }
                                });
                            }
                        }
                    },
                    Err(err) => {
                        set_error.set(Some(err.to_string()));
                        set_messages.update(|m| {
                            m.pop();
                        });
                        break;
                    }
                }
            }

            // After the loop, flush any remaining content in the buffer.
            if !buffer.is_empty() {
                accumulated_content.push_str(&buffer);
                set_messages.update(|m| {
                    if let Some(last) = m.last_mut() {
                        last.content = accumulated_content.clone();
                    }
                });
            }
        }
        Err(err) => {
            set_error.set(Some(err.to_string()));
            set_messages.update(|m| {
                m.pop();
            });
        }
    }
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
    // Props for lifted state
    #[prop(into)] api_key: Signal<String>,
    #[prop(into)] model_name: Signal<String>,
    #[prop(into)] set_model_name: WriteSignal<String>,
    // LIFTED from this component to App to fix panic
    #[prop(into)] input: Signal<String>,
    #[prop(into)] set_input: WriteSignal<String>,
    // New props for cached models
    #[prop(into)] cached_models: Signal<Vec<DisplayModelInfo>>,
    #[prop(into)] set_cached_models: WriteSignal<Vec<DisplayModelInfo>>,
) -> impl IntoView {
    leptos::logging::log!(
        "[LOG] [ChatInterface] Component created. Any `use_local_storage` here is risky."
    );
    on_cleanup(|| {
        leptos::logging::log!("[LOG] [ChatInterface] Component cleaned up. If a panic about disposed values follows, it's because a hook from here (like the old `use_local_storage` for input) is being called after cleanup.");
    });

    let (input_disabled, set_input_disabled) = signal(false);
    let (models_loading, set_models_loading) = signal(false);
    let (models_error, set_models_error) = signal::<Option<String>>(None);

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

    // Effect to fetch models if cache is empty and api key is present
    Effect::new(move |_| {
        if cached_models.get().is_empty() && !api_key.get().is_empty() {
            fetch_models.get_value()();
        }
    });

    // Effect to clear models if API key is removed
    Effect::new(move |_| {
        if api_key.get().is_empty() {
            set_cached_models.set(vec![]);
            set_models_error(None); // Clear any previous errors
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
                        // New format: compact, fixed-width, showing both prices.
                        // Using width 6 for numbers up to 999.99
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

    let submit = {
        move || {
            let model = llm::Model {
                model: current_model_name(),
                seed: None,
                temperature: Some(1.0),
            };
            spawn_local(async move {
                set_input_disabled.set(true);
                set_error(None);
                let system_prompt_content = selected_prompt()
                    .map(|sp| sp.prompt)
                    .unwrap_or("".to_string());

                let user_message = Message {
                    role: "user".to_string(),
                    content: input(),
                    prompt_name: None,
                    system_prompt_content: None,
                    model_name: None,
                    cost: None,
                };

                set_input("".to_string());
                set_messages.update(|m| m.push(user_message.clone()));

                if let Some(ref_history) = ref_history.get() {
                    log!("scrolling");
                    ref_history.set_scroll_top(ref_history.scroll_height());
                }

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
                    )
                    .await;
                }

                set_input_disabled.set(false);

                if let Some(ref_input) = ref_input.get() {
                    println!("focus");
                    let _ = ref_input.focus();
                }
            })
        }
    };

    let regenerate = {
        Arc::new(move |index: usize| {
            let model = llm::Model {
                model: current_model_name(),
                seed: None,
                temperature: Some(1.0),
            };
            spawn_local(async move {
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
                    )
                    .await;
                }

                set_input_disabled.set(false);
            })
        })
    };

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
                            view! {
                                <chat-message data-role="system">
                                    <chat-message-role>"system"</chat-message-role>
                                    <chat-message-content>
                                        <Markdown markdown_text=system_prompt.prompt />
                                    </chat-message-content>
                                </chat-message>
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
                                    regenerate=regenerate.clone()
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
            />
        </chat-interface>
    }
}

#[component]
fn ChatControls(
    #[prop(into)] input: Signal<String>,
    #[prop(into)] set_input: WriteSignal<String>,
    #[prop(into)] input_disabled: Signal<bool>,
    #[prop(into)] ref_input: NodeRef<html::Textarea>,
    #[prop(into)] submit: Arc<impl Fn() + std::marker::Send + std::marker::Sync + 'static>,
) -> impl IntoView {
    let submit2 = submit.clone();
    view! {
        <chat-controls>
            <form on:submit=move |ev| {
                ev.prevent_default();
                submit()
            }>
                <div style="display:flex; padding-left: 4px; padding-right: 4px; padding-bottom: 4px; gap: 4px;">
                    <textarea
                        prop:value=input
                        on:input:target=move |ev| set_input(ev.target().value())
                        placeholder="Message"
                        node_ref=ref_input
                        on:keydown:target=move |ev| {
                            if ev.key() == "Enter" && !ev.shift_key() {
                                ev.prevent_default();
                                submit2();
                            }
                        }
                        disabled=input_disabled
                    />
                    <button data-role="primary" style="flex-shrink:0" disabled=input_disabled>
                        "Go"
                    </button>
                </div>
            </form>
        </chat-controls>
    }
}

#[component]
fn Markdown(#[prop(into)] markdown_text: String) -> impl IntoView {
    let markdown_options = markdown::Options {
        parse: markdown::ParseOptions {
            constructs: markdown::Constructs {
                math_flow: true,
                math_text: true,
                ..markdown::Constructs::gfm()
            },
            ..markdown::ParseOptions::default()
        },
        compile: markdown::CompileOptions {
            allow_dangerous_html: true,
            allow_dangerous_protocol: true,
            ..markdown::CompileOptions::default()
        },
    };

    let content_div_ref = NodeRef::<html::Div>::new();

    Effect::new(move |_| {
        if let Some(div_element) = content_div_ref.get() {
            let html_output = markdown::to_html_with_options(&markdown_text, &markdown_options)
                .unwrap_or_else(|_| markdown_text.clone());

            dom_utils::set_html_content_with_copy_buttons(&div_element, &html_output);
        }
    });

    view! { <div node_ref=content_div_ref></div> }
}

use leptos::ev::KeyboardEvent;

#[component]
fn ChatMessage(
    #[prop(into)] message: Message,
    #[prop(into)] set_messages: WriteSignal<Vec<Message>>,
    #[prop(into)] message_index: usize,
    regenerate: Arc<impl Fn(usize) + std::marker::Send + std::marker::Sync + 'static>,
) -> impl IntoView {
    let (is_editing, set_is_editing) = signal(false);
    let (input, set_input) = signal(message.content.clone());

    let handle_resubmit = {
        let regenerate = regenerate.clone();
        let message = message.clone();
        move || {
            set_messages.update(|ms| {
                ms[message_index] = Message {
                    content: input.get(),
                    ..message.clone()
                };
            });
            set_is_editing(false);
            regenerate(message_index + 1);
        }
    };

    let regenerate = regenerate.clone();
    let m_clone_for_copy = message.clone();
    let text_for_copy_button = Signal::derive(move || {
        if is_editing.get() {
            input.get()
        } else {
            m_clone_for_copy.content.clone()
        }
    });
    let role = message.role.clone();
    let message_for_cost = message.clone();
    view! {
        <chat-message data-role=role>
            <div style="display: flex">
                <chat-message-role>
                    {if message.role == "assistant" {
                        if let Some(model) = &message.model_name {
                            format!("assistant ({model})")
                        } else {
                            "assistant".to_string()
                        }
                    } else {
                        message
                            .clone()
                            .prompt_name
                            .map(|name| "@".to_owned() + name.as_str())
                            .unwrap_or(message.role.clone())
                    }}
                </chat-message-role>
                <chat-message-buttons>
                    <CopyButton text_to_copy=text_for_copy_button />
                    {
                        let regenerate = regenerate.clone();
                        let message = message.clone();
                        move || {
                            let regenerate = regenerate.clone();
                            if message.role.clone() == "assistant" {
                                view! {
                                    <button
                                        data-size="compact"
                                        on:click=move |_| { regenerate(message_index) }
                                    >
                                        "regenerate"
                                    </button>
                                }
                                    .into_any()
                            } else if message.role.clone() == "user" {
                                view! {
                                    <button
                                        data-size="compact"
                                        on:click=move |_| {
                                            set_is_editing(!is_editing());
                                        }
                                    >
                                        "edit"
                                    </button>
                                }
                                    .into_any()
                            } else {
                                ().into_any()
                            }
                        }
                    }
                </chat-message-buttons>
            </div>
            <chat-message-content>
                {move || {
                    if is_editing() {
                        let handle_resubmit_for_textarea = handle_resubmit.clone();
                        let handle_resubmit_for_button = handle_resubmit.clone();
                        view! {
                            <textarea
                                style="width: 100%"
                                prop:value=input
                                on:input:target=move |ev| { set_input(ev.target().value()) }
                                on:keydown=move |ev: KeyboardEvent| {
                                    if ev.key() == "Enter" && !ev.shift_key() {
                                        ev.prevent_default();
                                        handle_resubmit_for_textarea();
                                    }
                                }
                            />
                            <div style="display:flex; justify-content: flex-end; gap: 4px;">
                                <button
                                    data-role="secondary"
                                    style="margin-left:auto;"
                                    on:click={
                                        let message = message.clone();
                                        move |_| {
                                            set_input(message.content.clone());
                                            set_is_editing(false);
                                        }
                                    }
                                >
                                    "Discard"
                                </button>
                                <button on:click=move |_| {
                                    handle_resubmit_for_button()
                                }>"Re-submit"</button>
                            </div>
                        }
                            .into_any()
                    } else {
                        let content = message.content.clone();
                        view! { <Markdown markdown_text=content /> }.into_any()
                    }
                }}
            </chat-message-content>
            {move || {
                message_for_cost
                    .cost
                    .map(|cost| {
                        view! {
                            <chat-message-cost style="text-align: right; font-size: 0.8em; opacity: 0.6; margin-top: 4px;">
                                {format!(
                                    "prompt: ${:.6}, completion: ${:.6}, total: ${:.6}",
                                    cost.prompt,
                                    cost.completion,
                                    cost.prompt + cost.completion,
                                )}
                            </chat-message-cost>
                        }
                    })
            }}
        </chat-message>
    }
}

#[component]
pub fn SystemPromptBar(
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] selected_prompt_name: Signal<Option<String>>,
    #[prop(into)] set_selected_prompt_name: WriteSignal<Option<String>>,
) -> impl IntoView {
    view! {
        {move || {
            let selected_prompt_name = selected_prompt_name();
            system_prompts()
                .iter()
                .map(|system_prompt| {
                    let name = system_prompt.name.clone();
                    let selected = selected_prompt_name.clone() == Some(name.clone());
                    view! {
                        <button
                            data-size="compact"
                            data-role="outline"
                            class="chat-controls-system-prompt"
                            data-selected=selected.to_string()
                            on:click={
                                let selected_prompt_name = selected_prompt_name.clone();
                                move |_| {
                                    if selected_prompt_name == Some(name.clone()) {
                                        set_selected_prompt_name(None)
                                    } else {
                                        set_selected_prompt_name(Some(name.clone()))
                                    }
                                }
                            }
                        >
                            {name.clone()}
                        </button>
                    }
                })
                .collect_view()
        }}
    }
}
