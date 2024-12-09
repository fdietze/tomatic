use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::{html, logging::log, prelude::*, task::spawn_local};
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
    let (loading, set_loading) = signal::<bool>(false);
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
                set_loading(true);
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
                set_messages.update(|m| m.push(user_message));
                if let Some(ref_history) = ref_history.get() {
                    log!("scrolling");
                    ref_history.set_scroll_top(ref_history.scroll_height());
                }
                let assistant_content: Result<String, anyhow::Error> = {
                    if api_key().is_empty() {
                        Err(anyhow::anyhow!(
                            "No API key provided. Please add one in Settings."
                        ))
                    } else {
                        let mut messages_to_submit = vec![system_message];
                        messages_to_submit.extend(messages());
                        llm::request_message_content(
                            messages_to_submit.iter().map(|m| m.to_llm()).collect(),
                            model,
                            api_key(),
                        )
                        .await
                    }
                };
                match assistant_content {
                    Ok(response_content) => {
                        let response_message = Message {
                            role: "assistant".to_string(),
                            content: response_content,
                            prompt_name: selected_prompt_name(),
                        };
                        set_input("".to_string());
                        set_messages.update(|m| m.push(response_message));
                    }
                    Err(err) => {
                        // remove previously added user message
                        set_messages.update(|m| {
                            m.pop();
                        });
                        set_error.set(Some(err.to_string()));
                    }
                };
                set_loading(false);
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
                set_loading(true);

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

                let assistant_content: Result<String, anyhow::Error> = {
                    if api_key().is_empty() {
                        Err(anyhow::anyhow!(
                            "No API key provided. Please add one in Settings."
                        ))
                    } else {
                        let mut messages_to_submit = vec![system_message];
                        messages_to_submit.extend(messages());
                        llm::request_message_content(
                            messages_to_submit.iter().map(|m| m.to_llm()).collect(),
                            model,
                            api_key(),
                        )
                        .await
                    }
                };
                match assistant_content {
                    Ok(response_content) => {
                        let response_message = Message {
                            role: "assistant".to_string(),
                            content: response_content,
                            prompt_name: selected_prompt_name(),
                        };
                        // set_input("".to_string());
                        set_messages.update(|m| m.push(response_message));
                    }
                    Err(err) => {
                        // remove previously added user message
                        set_messages.update(|m| {
                            m.pop();
                        });
                        set_error.set(Some(err.to_string()));
                    }
                };
                set_loading(false);
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
                                    message_index=message_index
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
                }} <Show when=move || loading()>
                    <chat-message-loading>"Loading..."</chat-message-loading>
                </Show>
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
                    data-role="compact"
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
                    <button style="flex-shrink:0">"Go"</button>
                </div>
            </form>
        </chat-controls>
    }
}

#[component]
fn ChatMessage(
    #[prop(into)] message: Message,
    #[prop(into)] message_index: usize,
    regenerate: Arc<impl Fn(usize) + std::marker::Send + std::marker::Sync + 'static>,
) -> impl IntoView {
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
        markdown::to_html_with_options(&message.content, &markdown_options)
            .unwrap_or(message.content);
    view! {
        <chat-message data-role=role>
            <div style="display: flex">
                <chat-message-role>
                    {message
                        .prompt_name
                        .map(|name| "@".to_owned() + name.as_str())
                        .unwrap_or(message.role.clone())}
                </chat-message-role>
                {move || {
                    let regenerate = regenerate.clone();
                    if message.role.clone() == "assistant" {
                        view! {
                            // TODO: use <Show>. The question is how to
                            // clone `regenerate`
                            <chat-message-buttons>
                                <button
                                    data-role="text"
                                    style="margin-left: auto;"
                                    on:click=move |_| { regenerate(message_index) }
                                >
                                    regenerate
                                </button>
                            </chat-message-buttons>
                        }
                            .into_any()
                    } else {
                        ().into_any()
                    }
                }}
            </div>
            <chat-message-content>
                <div inner_html=markdown_raw_html></div>
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
                            data-role="compact"
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
