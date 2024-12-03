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
    let system_prompt_name = move || {
        let system_prompts = system_prompts.get();
        let input = input.get();

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
    };
    let system_prompt = move || {
        let system_prompts = system_prompts.get();
        let system_prompt_name: Option<String> = system_prompt_name();
        system_prompt_name
            .and_then(|name| {
                system_prompts
                    .iter()
                    .find(|sp| sp.name == name)
                    .map(|sp| sp.prompt.clone())
            })
            .unwrap_or("".to_string())
    };

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
            let mut new_messages = messages.get();
            let system_message = Message {
                role: "system".to_string(),
                content: system_prompt(),
                system_prompt_name: None,
            };
            let mut messages_to_submit = vec![system_message];
            let user_message = Message {
                role: "user".to_string(),
                content: input.get(),
                system_prompt_name: None,
            };
            new_messages.push(user_message);
            set_messages.set(new_messages.clone());
            messages_to_submit.extend(new_messages.clone());
            set_input.set(
                system_prompt_name()
                    .map(|sp| format!("@{sp} "))
                    .unwrap_or("".to_string()),
            );
            let assistant_content = llm::request_message_content(
                messages_to_submit.iter().map(|m| m.to_llm()).collect(),
                model,
                api_key.get(),
            )
            .await
            .unwrap();
            let assistant_message = Message {
                role: "assistant".to_string(),
                content: assistant_content,
                system_prompt_name: system_prompt_name(),
            };
            new_messages.push(assistant_message);
            set_messages.set(new_messages);
        })
    };
    let submit2 = submit.clone();

    view! {
        <chat-interface>
            <chat-history>
                {move || {
                    messages
                        .get()
                        .into_iter()
                        .map(|message| {
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
                                <chat-message>
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
                }}
            </chat-history>
            <chat-controls>
                <div style:display="flex">
                    <button
                        on:click=move |_| {
                            set_messages.set(vec![]);
                        }
                        style:margin-left="auto"
                    >
                        "New Chat"
                    </button>
                </div>
                <form on:submit=move |_| submit.clone()()>
                    <textarea
                        prop:value=move || input.get()
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
                    />
                </form>
            </chat-controls>
        </chat-interface>
    }
}
