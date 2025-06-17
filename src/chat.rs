use codee::string::FromToStringCodec;
use futures::{pin_mut, StreamExt};
use leptos::logging::log;
use leptos::{html, prelude::*, task::spawn_local};
use leptos_use::storage::use_local_storage;
use wasm_bindgen::{closure::Closure, JsCast};
use web_sys::{HtmlButtonElement, HtmlPreElement, Node, Clipboard}; // Removed HtmlElement, Added Clipboard
use wasm_bindgen_futures::JsFuture;
use gloo_timers::callback::Timeout;
use serde::{Deserialize, Serialize};

use crate::llm::DisplayModelInfo;
use std::sync::Arc;

use crate::llm;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SystemPrompt {
    pub name: String,
    pub prompt: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    prompt_name: Option<String>,
    role: String,
    content: String,
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
                            prompt_name: None,
                        });
                    }
                    messages_to_submit.extend(messages());

                    // Create placeholder response message
                    let response_message = Message {
                        role: "assistant".to_string(),
                        content: String::new(),
                        prompt_name: selected_prompt_name(),
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
                            prompt_name: None,
                        });
                    }
                    messages_to_submit.extend(messages());

                    // Create placeholder response message
                    let response_message = Message {
                        role: "assistant".to_string(),
                        content: String::new(),
                        prompt_name: selected_prompt_name(),
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
                <div style="padding: 4px; border-bottom: 1px solid var(--border-color); background-color: var(--background-secondary-color);">
                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 5px;">
                        {move || {
                            if api_key.get().is_empty() {
                                view! {
                                    <p style="margin:0; font-size: 0.9em;">
                                        "Enter API key in Settings to load models."
                                    </p>
                                }
                                    .into_any()
                            } else if models_loading.get() {
                                view! {
                                    <p style="margin:0; font-size: 0.9em;">"Loading models..."</p>
                                }
                                    .into_any()
                            } else {
                                match fetched_models_result.get() {
                                    Some(Ok(models)) => {
                                        view! {
                                            <select
                                                id="model-select"
                                                style="flex-grow: 1; min-width: 150px;"
                                                on:change=move |ev| {
                                                    let new_value = event_target_value(&ev);
                                                    set_model_name_storage.set(new_value);
                                                }
                                            >
                                                <option
                                                    value=""
                                                    selected=model_name_storage.get().is_empty()
                                                    disabled=true
                                                >
                                                    "Select a model"
                                                </option>
                                                {models
                                                    .into_iter()
                                                    .map(|model_info| {
                                                        let is_selected = model_name_storage.get() == model_info.id;
                                                        let display_text = if let (
                                                            Some(prompt_cost),
                                                            Some(completion_cost),
                                                        ) = (
                                                            model_info.prompt_cost_usd_pm,
                                                            model_info.completion_cost_usd_pm,
                                                        ) {
                                                            format!(
                                                                "{} (P: ${:.2}/MTok C: ${:.2}/MTok)",
                                                                model_info.name,
                                                                prompt_cost,
                                                                completion_cost,
                                                            )
                                                        } else {
                                                            model_info.name.clone()
                                                        };
                                                        view! {
                                                            <option value=model_info.id.clone() selected=is_selected>
                                                                {display_text}
                                                            </option>
                                                        }
                                                    })
                                                    .collect_view()}
                                            </select>
                                        }
                                            .into_any()
                                    }
                                    Some(Err(e)) => {
                                        view! {
                                            <p style="color: red; margin:0; font-size: 0.9em;">
                                                "Error loading models: " {e.to_string()}
                                            </p>
                                        }
                                            .into_any()
                                    }
                                    None => {
                                        view! {
                                            <p style="margin:0; font-size: 0.9em;">
                                                "No models loaded or API key might be invalid."
                                            </p>
                                        }
                                            .into_any()
                                    }
                                }
                            }
                        }}
                    </div>
                    <input
                        type="text"
                        style="width: 100%; padding: 8px; border: 1px solid var(--border-color);"
                        prop:value=move || model_name_storage.get()
                        on:input:target=move |ev| set_model_name_storage.set(ev.target().value())
                        placeholder="Or enter model manually (e.g., openai/gpt-4o)"
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
            allow_dangerous_html: true, // Needed if markdown contains HTML
            allow_dangerous_protocol: true, // Needed for certain links if any
            ..markdown::CompileOptions::default()
        },
    };

    let content_div_ref = NodeRef::<html::Div>::new();

    Effect::new(move |_| {
        if let Some(div_element) = content_div_ref.get() {
            let html_output = markdown::to_html_with_options(&markdown_text, &markdown_options)
                .unwrap_or_else(|_| markdown_text.clone()); // Fallback for safety
            div_element.set_inner_html(&html_output);

            let document = document();
            match div_element.query_selector_all("pre") {
                Ok(pre_elements) => {
                    for i in 0..pre_elements.length() {
                        if let Some(node) = pre_elements.item(i) {
                            if let Ok(pre_el) = node.dyn_into::<HtmlPreElement>() {
                                if let Ok(button_el_as_element) = document.create_element("button") {
                                    if let Ok(button_el) = button_el_as_element.dyn_into::<HtmlButtonElement>() {
                                        button_el.set_class_name("copy-button");
                                        button_el.set_text_content(Some("Copy"));

                                        let pre_el_clone = pre_el.clone();
                                        let button_el_clone_for_handler = button_el.clone();

                                        let click_handler = Closure::wrap(Box::new(move |_event: web_sys::MouseEvent| {
                                            let text_to_copy = if let Ok(Some(code_node)) = pre_el_clone.query_selector("code") {
                                                code_node.text_content().unwrap_or_default()
                                            } else {
                                                let mut content = String::new();
                                                let children = pre_el_clone.child_nodes();
                                                for idx in 0..children.length() {
                                                    if let Some(child_node) = children.item(idx) {
                                                        if let Some(btn_node_ref) = button_el_clone_for_handler.dyn_ref::<Node>() {
                                                            if child_node.is_same_node(Some(btn_node_ref)) {
                                                                continue;
                                                            }
                                                        }
                                                        content.push_str(&child_node.text_content().unwrap_or_default());
                                                    }
                                                }
                                                content.trim().to_string()
                                            };


                                            if !text_to_copy.is_empty() {
                                                let clipboard_opt: Option<Clipboard> = Some(window().navigator().clipboard());
                                                if let Some(clipboard) = clipboard_opt {
                                                    let promise = clipboard.write_text(&text_to_copy);
                                                    let button_for_feedback = button_el_clone_for_handler.clone();
                                                    spawn_local(async move {
                                                        match JsFuture::from(promise).await {
                                                            Ok(_) => {
                                                                button_for_feedback.set_text_content(Some("Copied!"));
                                                                let _ = button_for_feedback.class_list().add_1("copied");
                                                                let timeout_button = button_for_feedback.clone();
                                                                Timeout::new(1500, move || {
                                                                    timeout_button.set_text_content(Some("Copy"));
                                                                    let _ = timeout_button.class_list().remove_1("copied");
                                                                }).forget();
                                                            }
                                                            Err(e) => {
                                                                log!("Error copying to clipboard: {:?}", e);
                                                                button_for_feedback.set_text_content(Some("Error"));
                                                                let timeout_button = button_for_feedback.clone();
                                                                 Timeout::new(1500, move || {
                                                                    timeout_button.set_text_content(Some("Copy"));
                                                                }).forget();
                                                            }
                                                        }
                                                    });
                                                } else {
                                                    log!("Clipboard API not available or not in secure context.");
                                                }
                                            }
                                        }) as Box<dyn FnMut(_)>);

                                        if button_el.add_event_listener_with_callback("click", click_handler.as_ref().unchecked_ref()).is_ok() {
                                            click_handler.forget(); // Leak the closure to keep it alive
                                            let _ = pre_el.append_child(&button_el);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log!("Failed to querySelectorAll for pre elements: {:?}", e);
                }
            }
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
                    {
                        let regenerate = regenerate.clone();
                        let message = message.clone();
                        move || {
                            let regenerate = regenerate.clone();
                            if message.role.clone() == "assistant" {
                                view! {
                                    <button
                                        data-role="text"
                                        style="margin-left: auto;"
                                        on:click=move |_| { regenerate(message_index) }
                                    >
                                        regenerate
                                    </button>
                                }
                                    .into_any()
                            } else if message.role.clone() == "user" {
                                view! {
                                    <button
                                        data-role="text"
                                        style="margin-left: auto;"
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
