#![feature(async_closure)]

mod llm;
mod settings;

use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::{html, prelude::*, task::spawn_local};
use leptos_use::storage::use_local_storage;
use serde::{Deserialize, Serialize};

// TODO: model selection
// TODO: streaming
// TODO: markdown
// TODO: math symbols

fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(App);
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Default)]
enum Page {
    #[default]
    Chat,
    Settings,
}

#[component]
fn App() -> impl IntoView {
    let (page, set_page, _) = use_local_storage::<Page, JsonSerdeCodec>("page");
    view! {
        <header>
            <button on:click=move |_| set_page.set(Page::Chat)>Chat</button>
            <button on:click=move |_| set_page.set(Page::Settings)>Settings</button>
        </header>
        {move || match page.get() {
            Page::Chat => view! { <ChatInterface /> }.into_any(),
            Page::Settings => view! { <settings::Settings /> }.into_any(),
        }}
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
struct Message {
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
fn ChatInterface() -> impl IntoView {
    let (messages, set_messages, _) = use_local_storage::<Vec<Message>, JsonSerdeCodec>("messages");
    let (input, set_input) = signal("".to_string());
    let (api_key, set_api_key, _) =
        use_local_storage::<String, FromToStringCodec>("OPENAI_API_KEY");
    let (system_prompt, set_system_prompt, _) =
        use_local_storage::<String, FromToStringCodec>("system_prompt");

    let ref_input: NodeRef<html::Textarea> = NodeRef::new();

    Effect::new(move |_| {
        if let Some(ref_input) = ref_input.get() {
            let _ = ref_input.focus();
        }
    });

    view! {
        <chat-interface>
            <chat-history>
                {move || {
                    messages
                        .get()
                        .into_iter()
                        .map(|message| {
                            view! {
                                <chat-message>
                                    <chat-message-role>{message.role}</chat-message-role>
                                    <chat-message-content>{message.content}</chat-message-content>
                                </chat-message>
                            }
                        })
                        .collect_view()
                }}
            </chat-history>
            <form on:submit=move |_| spawn_local(async move {
                submit(
                        api_key.get_untracked(),
                        system_prompt.get_untracked(),
                        messages.get_untracked(),
                        input.get_untracked(),
                        |new_input| set_input.set(new_input),
                        |new_messages| set_messages.set(new_messages),
                    )
                    .await;
            })>
                <textarea
                    prop:value=move || input.get()
                    on:input:target=move |ev| set_input.set(ev.target().value())
                    title="ctrl+enter to submit"
                    node_ref=ref_input
                    on:keydown:target=move |ev| spawn_local(async move {
                        if ev.key() == "Enter" && ev.ctrl_key() {
                            ev.prevent_default();
                            submit(
                                    api_key.get_untracked(),
                                    system_prompt.get_untracked(),
                                    messages.get_untracked(),
                                    input.get_untracked(),
                                    |new_input| set_input.set(new_input),
                                    |new_messages| set_messages.set(new_messages),
                                )
                                .await;
                        }
                    })
                />
            </form>
        </chat-interface>
    }
}

async fn submit(
    api_key: String,
    system_prompt: String,
    messages: Vec<Message>,
    input: String,
    set_input: impl Fn(String),
    set_messages: impl Fn(Vec<Message>),
) {
    let mut new_messages = messages;
    let system_message = Message {
        role: "system".to_string(),
        content: system_prompt,
    };
    let mut messages_to_submit = vec![system_message];
    let user_message = Message {
        role: "user".to_string(),
        content: input,
    };
    new_messages.push(user_message);
    set_messages(new_messages.clone());
    messages_to_submit.extend(new_messages.clone());
    set_input("".to_string());
    let assistant_content = llm::request_str(
        messages_to_submit.iter().map(|m| m.to_llm()).collect(),
        api_key,
    )
    .await
    .unwrap();
    let assistant_message = Message {
        role: "assistant".to_string(),
        content: assistant_content,
    };
    new_messages.push(assistant_message);
    set_messages(new_messages);
}
