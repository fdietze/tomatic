use codee::string::FromToStringCodec;
use futures::{pin_mut, StreamExt};
use leptos::logging::log;
use leptos::{html, prelude::*, task::spawn_local};
use leptos_use::storage::use_local_storage;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
// Imports moved to dom_utils.rs as they are no longer directly used here
// use wasm_bindgen::{closure::Closure, JsCast};
// use web_sys::{HtmlButtonElement, HtmlPreElement, Node};
// use wasm_bindgen_futures::JsFuture;
// use gloo_timers::callback::Timeout;

use crate::copy_button::CopyButton;
use crate::dom_utils;
use crate::llm;
use crate::llm::DisplayModelInfo;
use crate::combobox::{Combobox, ComboboxItem};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SystemPrompt {
    pub name: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    prompt_name: Option<String>,
    role: String,
    content: String,
    model_name: Option<String>, // Added to store the model used for this message
    system_prompt_content: Option<String>, // Added to store the full system prompt content
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

#[component]
pub fn ChatInterface(
    #[prop(into)] messages: Signal<Vec<Message>>,
    #[prop(into)] set_messages: WriteSignal<Vec<Message>>,
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] selected_prompt_name: Signal<Option<String>>,
    #[prop(into)] set_selected_prompt_name: WriteSignal<Option<String>>,
    #[prop(into)] error: Signal<Option<String>>,
    #[prop(into)] set_error: WriteSignal<Option<String>>,
) -> impl IntoView {
    let (input, set_input, _) = use_local_storage::<String, FromToStringCodec>("input");
    let (api_key, _, _) = use_local_storage::<String, FromToStringCodec>("OPENROUTER_API_KEY");
    let (model_name_storage, set_model_name_storage, _) =
        use_local_storage::<String, FromToStringCodec>("MODEL_NAME");
    let (input_disabled, set_input_disabled) = signal(false);
    let (fetched_models_result, set_fetched_models_result) =
        signal::<Option<Result<Vec<DisplayModelInfo>, String>>>(None);
    let (models_loading, set_models_loading) = signal(false);
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

    let combobox_items = Memo::new(move |_| match fetched_models_result.get() {
        Some(Ok(models)) => models
            .into_iter()
            .map(|model_info| {
                let display_text =
                    if let (Some(prompt_cost), Some(completion_cost)) =
                        (model_info.prompt_cost_usd_pm, model_info.completion_cost_usd_pm)
                    {
                        format!(
                            "{} (ID: {}) (P: ${:.2}/MTok C: ${:.2}/MTok)",
                            model_info.name, model_info.id, prompt_cost, completion_cost,
                        )
                    } else {
                        format!("{} (ID: {})", model_info.name, model_info.id)
                    };
                ComboboxItem { id: model_info.id.clone(), display_text }
            })
            .collect::<Vec<ComboboxItem>>(),
        _ => Vec::new(),
    });

    let combobox_external_error = Memo::new(move |_| {
        if api_key.get().is_empty() {
            Some("API key required in Settings to use models.".to_string())
        } else {
            match fetched_models_result.get() {
                Some(Err(e)) => Some(format!("Failed to load models: {e}")),
                Some(Ok(models)) if models.is_empty() && !models_loading.get() => {
                    Some("No models found from API.".to_string())
                }
                _ => None,
            }
        }
    });

    Effect::new(move |_| {
        if let Some(ref_input) = ref_input.get() {
            let _ = ref_input.focus();
        }
    });

    Effect::new(move |_| {
        let current_api_key = api_key();
        if current_api_key.is_empty() {
            set_fetched_models_result(None);
            set_models_loading(false);
            return;
        }

        set_models_loading(true);
        spawn_local(async move {
            let result = crate::llm::list_available_models(current_api_key)
                .await
                .map_err(|e| e.to_string());
            set_fetched_models_result(Some(result));
            set_models_loading(false);
        });
    });

    let current_model_name = Memo::new(move |_| {
        let name = model_name_storage();
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
                            system_prompt_content: selected_prompt.get().map(|sp| sp.prompt.clone()),
                            model_name: Some(current_model_name()), // Added
                        });
                    }
                    messages_to_submit.extend(messages());

                    // Create placeholder response message
                    let response_message = Message {
                        role: "assistant".to_string(),
                        content: String::new(),
                        prompt_name: selected_prompt.get().map(|sp| sp.name.clone()),
                        system_prompt_content: selected_prompt.get().map(|sp| sp.prompt.clone()),
                        model_name: Some(current_model_name()),
                    };
                    set_messages.update(|m| m.push(response_message));

                    match llm::request_message_content_streamed(
                        messages_to_submit.iter().map(|m| m.to_llm()).collect(),
                        model,
                        api_key(),
                    )
                    .await
                    {
                        Ok(stream) => {
                            let mut accumulated_content = String::new();
                            pin_mut!(stream);

                            while let Some(chunk_result) = stream.next().await {
                                match chunk_result {
                                    Ok(content) => {
                                        accumulated_content.push_str(&content);
                                        // Update the last message with accumulated content
                                        set_messages.update(|m| {
                                            if let Some(last) = m.last_mut() {
                                                last.content = accumulated_content.clone();
                                            }
                                        });
                                    }
                                    Err(err) => {
                                        set_error.set(Some(err.to_string()));
                                        // Remove the incomplete message
                                        set_messages.update(|m| {
                                            m.pop();
                                        });
                                        break;
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            set_error.set(Some(err.to_string()));
                            // Remove the incomplete message
                            set_messages.update(|m| {
                                m.pop();
                            });
                        }
                    }
                }

                set_input_disabled.set(false);

                if let Some(ref_input) = ref_input.get() {
                    // TODO
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

                // remove all messages starting at index
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
                            system_prompt_content: selected_prompt.get().map(|sp| sp.prompt.clone()),
                            model_name: Some(current_model_name()), // Added
                        });
                    }
                    messages_to_submit.extend(messages());

                    // Create placeholder response message
                    let response_message = Message {
                        role: "assistant".to_string(),
                        content: String::new(),
                        prompt_name: selected_prompt.get().map(|sp| sp.name.clone()),
                        system_prompt_content: selected_prompt.get().map(|sp| sp.prompt.clone()),
                        model_name: Some(current_model_name()),
                    };
                    set_messages.update(|m| m.push(response_message));

                    // Similar streaming logic as submit
                    match llm::request_message_content_streamed(
                        messages_to_submit.iter().map(|m| m.to_llm()).collect(),
                        model,
                        api_key(),
                    )
                    .await
                    {
                        Ok(stream) => {
                            let mut accumulated_content = String::new();
                            pin_mut!(stream);

                            while let Some(chunk_result) = stream.next().await {
                                match chunk_result {
                                    Ok(content) => {
                                        accumulated_content.push_str(&content);
                                        set_messages.update(|m| {
                                            if let Some(last) = m.last_mut() {
                                                last.content = accumulated_content.clone();
                                            }
                                        });
                                    }
                                    Err(err) => {
                                        set_error.set(Some(err.to_string()));
                                        set_messages.update(|m| {
                                            m.pop();
                                        });
                                        break;
                                    }
                                }
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

                set_input_disabled.set(false);
            })
        })
    };

    view! {
        <chat-interface>
            <chat-history node_ref=ref_history>
                // Added z-index for combobox dropdown
                <div style="padding: 4px; border-bottom: 1px solid var(--border-color); background-color: var(--background-secondary-color); position: relative; z-index: 10;">
                    <Combobox
                        items=combobox_items
                        selected_id=model_name_storage
                        on_select=Callback::new(move |id_str: String| {
                            set_model_name_storage.set(id_str)
                        })
                        placeholder="Select or type model ID (e.g. openai/gpt-4o)".to_string()
                        loading=models_loading
                        error_message=combobox_external_error
                        disabled=Signal::derive(move || api_key.get().is_empty())
                    />
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
                                    <div style="font-weight: bold">error</div>
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
            allow_dangerous_html: true,     // Needed if markdown contains HTML
            allow_dangerous_protocol: true, // Needed for certain links if any
            ..markdown::CompileOptions::default()
        },
    };

    let content_div_ref = NodeRef::<html::Div>::new();

    Effect::new(move |_| {
        if let Some(div_element) = content_div_ref.get() {
            let html_output = markdown::to_html_with_options(&markdown_text, &markdown_options)
                .unwrap_or_else(|_| markdown_text.clone()); // Fallback for safety

            // Use the helper function to set HTML and add copy buttons
            dom_utils::set_html_content_with_copy_buttons(&div_element, &html_output);
        }
    });

    view! { <div node_ref=content_div_ref></div> }
}

#[component]
fn ChatMessage(
    #[prop(into)] message: Message,
    #[prop(into)] set_messages: WriteSignal<Vec<Message>>,
    #[prop(into)] message_index: usize,
    regenerate: Arc<impl Fn(usize) + std::marker::Send + std::marker::Sync + 'static>,
) -> impl IntoView {
    let (is_editing, set_is_editing) = signal(false);
    let (input, set_input) = signal(message.content.clone());

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
    view! {
        <chat-message data-role=role>
            <div style="display: flex">
                <chat-message-role>
                    {message
                        .clone()
                        .prompt_name
                        .map(|name| "@".to_owned() + name.as_str())
                        .unwrap_or(message.role.clone())}
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
                                        regenerate
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
                                        edit
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
                    let regenerate = regenerate.clone();
                    let message = message.clone();
                    if is_editing() {
                        view! {
                            <textarea
                                style="width: 100%"
                                prop:value=input
                                on:input:target=move |ev| { set_input(ev.target().value()) }
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
                                    Discard
                                </button>
                                <button on:click=move |_| {
                                    let message = message.clone();
                                    set_messages
                                        .update(|ms| {
                                            ms[message_index] = Message {
                                                content: input(),
                                                ..message
                                            };
                                        });
                                    set_is_editing(false);
                                    regenerate(message_index + 1);
                                }>Re-submit</button>
                            </div>
                        }
                            .into_any()
                    } else {
                        view! { <Markdown markdown_text=message.content /> }.into_any()
                    }
                }}
            </chat-message-content>
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
