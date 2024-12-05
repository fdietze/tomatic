use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::{html, prelude::*, task::spawn_local};
use leptos_use::storage::use_local_storage;
use serde::{Deserialize, Serialize};

use crate::llm;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SystemPrompt {
    pub name: String,
    pub prompt: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    system_prompt_name: Option<String>,
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

#[component]
pub fn ChatInterface() -> impl IntoView {
    let (messages, set_messages, _) = use_local_storage::<Vec<Message>, JsonSerdeCodec>("messages");
    let (input, set_input, _) = use_local_storage::<String, FromToStringCodec>("input");
    let (api_key, _, _) = use_local_storage::<String, FromToStringCodec>("OPENAI_API_KEY");
    let (system_prompts, _, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");
    let (textarea_disabled, set_textarea_disabled) = signal(false);
    let (error, set_error) = signal::<Option<String>>(None);
    let selected_system_prompt_name = Memo::new(move |_| {
        let system_prompts = system_prompts();
        let input = input();

        // find first occurrence of mention @name from a list of valid names in input.
        input.split(' ').find_map(|word| {
            if !word.starts_with('@') {
                return None;
            }
            let name = &word[1..];
            // remove punctuation at the end
            let name = name.trim_matches(|c: char| !c.is_alphanumeric());
            if system_prompts.iter().any(|sp| sp.name == name) {
                Some(name.to_string())
            } else {
                None
            }
        })
    });
    let selected_system_prompt = Memo::new(move |_| {
        let system_prompts = system_prompts();
        let system_prompt_name: Option<String> = selected_system_prompt_name();
        system_prompt_name
            .and_then(|name| system_prompts.iter().find(|sp| sp.name == name))
            .cloned()
    });

    let ref_input: NodeRef<html::Textarea> = NodeRef::new();

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

    let submit = move || {
        spawn_local(async move {
            set_textarea_disabled.set(true);
            let mut new_messages = messages();
            let system_message = Message {
                role: "system".to_string(),
                content: selected_system_prompt()
                    .map(|sp| sp.prompt)
                    .unwrap_or("".to_string()),
                system_prompt_name: None,
            };
            let mut messages_to_submit = vec![system_message];
            let user_message = Message {
                role: "user".to_string(),
                content: input(),
                system_prompt_name: None,
            };
            new_messages.push(user_message);
            set_messages.set(new_messages.clone());
            messages_to_submit.extend(new_messages.clone());
            let assistant_content: Result<String, anyhow::Error> = {
                if api_key().is_empty() {
                    Err(anyhow::anyhow!(
                        "No API key provided. Please add one in Settings."
                    ))
                } else {
                    llm::request_message_content(
                        messages_to_submit.iter().map(|m| m.to_llm()).collect(),
                        model,
                        api_key(),
                    )
                    .await
                }
            };
            match assistant_content {
                Ok(assistant_content) => {
                    new_messages.push(Message {
                        role: "assistant".to_string(),
                        content: assistant_content,
                        system_prompt_name: selected_system_prompt_name(),
                    });
                    set_messages.set(new_messages);
                    set_input.set(
                        selected_system_prompt_name()
                            .map(|sp| format!("@{sp} "))
                            .unwrap_or("".to_string()),
                    );
                }
                Err(err) => {
                    // remove previously added user message
                    new_messages.pop();
                    set_messages.set(new_messages);
                    set_error.set(Some(err.to_string()));
                }
            };
            set_textarea_disabled.set(false);
            if let Some(ref_input) = ref_input.get() {
                println!("focus");
                let _ = ref_input.focus();
            }
        })
    };
    let submit2 = submit.clone();

    view! {
        <chat-interface>
            <chat-history>
                {move || {
                    messages()
                        .into_iter()
                        .map(|message| {
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
                            let markdown_raw_html: String = markdown::to_html_with_options(
                                    &message.content,
                                    &markdown_options,
                                )
                                .unwrap_or(message.content);
                            view! {
                                <chat-message data-role=role>
                                    <chat-message-role>
                                        {message
                                            .system_prompt_name
                                            .map(|name| "@".to_owned() + name.as_str())
                                            .unwrap_or(message.role)}
                                    </chat-message-role>
                                    <chat-message-content>
                                        <div inner_html=markdown_raw_html></div>
                                    </chat-message-content>
                                </chat-message>
                            }
                        })
                        .collect_view()
                }} {move || error().map(|error| view! { <error-box>{error}</error-box> })}
                // workaround to
                // make Memo keep its state
                {move || {
                    let _ = selected_system_prompt();
                    ""
                }}
            </chat-history>
            <chat-controls>
                <div style="display: flex; flex-wrap: wrap;">
                    <SystemPromptBar
                        system_prompts=system_prompts
                        selected_prompt_name=selected_system_prompt_name
                        input=input
                        set_input=set_input
                    />
                    <button
                        on:click=move |_| {
                            set_messages.set(vec![]);
                            set_error.set(None);
                        }
                        style:margin-left="auto"
                    >
                        "New Chat"
                    </button>
                </div>
                <form on:submit=move |ev| {
                    ev.prevent_default();
                    submit.clone()()
                }>
                    <div style:display="flex">
                        <textarea
                            prop:value=input
                            on:input:target=move |ev| set_input.set(ev.target().value())
                            placeholder="Message"
                            title="ctrl+enter to submit"
                            node_ref=ref_input
                            on:keydown:target=move |ev| {
                                if ev.key() == "Enter" && ev.ctrl_key() {
                                    ev.prevent_default();
                                    submit2.clone()();
                                }
                            }
                            disabled=textarea_disabled
                        />
                        <button style="flex-shrink:0; width:40px">"Go"</button>
                    </div>
                </form>
            </chat-controls>
        </chat-interface>
    }
}

#[component]
fn SystemPromptBar(
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] selected_prompt_name: Signal<Option<String>>,
    #[prop(into)] input: Signal<String>,
    #[prop(into)] set_input: WriteSignal<String>,
) -> impl IntoView {
    view! {
        {move || {
            let selected_prompt_name = selected_prompt_name();
            system_prompts()
                .iter()
                .map(|system_prompt| {
                    let name = system_prompt.name.clone();
                    let selected = selected_prompt_name == Some(name.clone());
                    view! {
                        <chat-controls-system-prompt
                            data-selected=selected.to_string()
                            on:click=move |_| set_input(format!("{}@{} ", input(), &name.clone()))
                        >
                            {name.clone()}
                        </chat-controls-system-prompt>
                    }
                })
                .collect_view()
        }}
    }
}
