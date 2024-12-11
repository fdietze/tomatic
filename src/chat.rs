use codee::string::{FromToStringCodec, JsonSerdeCodec};
use futures::{pin_mut, StreamExt};
use leptos::logging::log;
use leptos::{html, prelude::*, task::spawn_local};
use leptos_use::storage::use_local_storage;
use serde::{Deserialize, Serialize};
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
pub fn ChatInterface() -> impl IntoView {
    let (messages, set_messages, _) = use_local_storage::<Vec<Message>, JsonSerdeCodec>("messages");
    let (input, set_input, _) = use_local_storage::<String, FromToStringCodec>("input");
    let (api_key, _, _) = use_local_storage::<String, FromToStringCodec>("OPENAI_API_KEY");
    let (system_prompts, _, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");
    let (input_disabled, set_input_disabled) = signal(false);
    let (error, set_error) = signal::<Option<String>>(None);
    let (selected_prompt_name, set_selected_prompt_name, _) =
        use_local_storage::<Option<String>, JsonSerdeCodec>("selected_prompt_name");
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

    let model = llm::Model {
        model: "gpt-4o".to_string(),
        seed: None,
        top_p: None,
        temperature: None,
    };

    let submit = {
        let model = model.clone();
        move || {
            let model = model.clone();
            spawn_local(async move {
                set_input_disabled.set(true);
                set_error(None);
                let system_message = Message {
                    role: "system".to_string(),
                    content: selected_prompt()
                        .map(|sp| sp.prompt)
                        .unwrap_or("".to_string()),
                    prompt_name: None,
                };
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
                    let mut messages_to_submit = vec![system_message];
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
        let model = model.clone();
        Arc::new(move |index: usize| {
            let model = model.clone();
            spawn_local(async move {
                set_input_disabled.set(true);
                set_error(None);

                // remove all messages starting at index
                set_messages.update(|m| {
                    m.drain(index..);
                });

                let system_message = Message {
                    role: "system".to_string(),
                    content: selected_prompt()
                        .map(|sp| sp.prompt)
                        .unwrap_or("".to_string()),
                    prompt_name: None,
                };

                if api_key().is_empty() {
                    set_error.set(Some(
                        "No API key provided. Please add one in Settings.".to_string(),
                    ));
                } else {
                    let mut messages_to_submit = vec![system_message];
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
                {move || {
                    selected_prompt()
                        .map(|system_prompt| {
                            view! {
                                <chat-message data-role="system">
                                    <chat-message-role>"system"</chat-message-role>
                                    <chat-message-content>
                                        {system_prompt.prompt}
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
                system_prompts=system_prompts
                selected_prompt_name=selected_prompt_name
                set_selected_prompt_name=set_selected_prompt_name
                set_messages=set_messages
                set_error=set_error
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
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] selected_prompt_name: Signal<Option<String>>,
    #[prop(into)] set_selected_prompt_name: WriteSignal<Option<String>>,
    #[prop(into)] set_messages: WriteSignal<Vec<Message>>,
    #[prop(into)] set_error: WriteSignal<Option<String>>,
    #[prop(into)] input: Signal<String>,
    #[prop(into)] set_input: WriteSignal<String>,
    #[prop(into)] input_disabled: Signal<bool>,
    #[prop(into)] ref_input: NodeRef<html::Textarea>,
    #[prop(into)] submit: Arc<impl Fn() + std::marker::Send + std::marker::Sync + 'static>,
) -> impl IntoView {
    let submit2 = submit.clone();
    view! {
        <chat-controls>
            <chat-controls-buttons>
                <SystemPromptBar
                    system_prompts=system_prompts
                    selected_prompt_name=selected_prompt_name
                    set_selected_prompt_name=set_selected_prompt_name
                />
                <button
                    data-role="outline"
                    data-size="compact"
                    on:click=move |_| {
                        set_messages(vec![]);
                        set_error(None);
                    }
                    style:margin-left="auto"
                >
                    "New Chat"
                </button>
            </chat-controls-buttons>
            <form on:submit=move |ev| {
                ev.prevent_default();
                submit()
            }>
                <div style="display:flex; padding-left: 4px; padding-right: 4px; padding-bottom: 4px; gap: 4px;">
                    <textarea
                        prop:value=input
                        on:input:target=move |ev| set_input(ev.target().value())
                        placeholder="Message"
                        title="ctrl+enter to submit"
                        node_ref=ref_input
                        on:keydown:target=move |ev| {
                            if ev.key() == "Enter" && ev.ctrl_key() {
                                ev.prevent_default();
                                submit2();
                            }
                        }
                        disabled=input_disabled
                    />
                    <button style="flex-shrink:0" disabled=input_disabled>
                        "Go"
                    </button>
                </div>
            </form>
        </chat-controls>
    }
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
            ..markdown::CompileOptions::default()
        },
    };

    let markdown_raw_html: String =
        markdown::to_html_with_options(&message.content.clone(), &markdown_options)
            .unwrap_or(message.content.clone());
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
                        let markdown_raw_html = markdown_raw_html.clone();
                        view! { <div inner_html=markdown_raw_html></div> }.into_any()
                    }
                }}
            </chat-message-content>
        </chat-message>
    }
}

#[component]
fn SystemPromptBar(
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
