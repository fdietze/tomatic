#![feature(async_closure)]

mod llm;

use codee::string::FromToStringCodec;
use leptos::{html, prelude::*, task::spawn_local};
use leptos_use::storage::use_local_storage;

fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(App);
}

#[derive(Clone)]
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
fn App() -> impl IntoView {
    let (messages, set_messages) = signal::<Vec<Message>>(vec![]);
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
        <div>
            <input
                type="text"
                prop:value=move || api_key.get()
                on:input:target=move |ev| set_api_key.set(ev.target().value())
                placeholder="OPENAI_API_KEY"
            />
            <textarea
                prop:value=move || system_prompt.get()
                on:input:target=move |ev| set_system_prompt.set(ev.target().value())
                placeholder="system prompt"
            />
        </div>

        <div>
            {move || {
                messages
                    .get()
                    .into_iter()
                    .map(|message| {
                        view! {
                            <div>
                                <div style:opacity="0.5">{message.role}</div>
                                <pre style:white-space="break-spaces">{message.content}</pre>
                            </div>
                        }
                    })
                    .collect_view()
            }}
        </div>
        <textarea
            prop:value=move || input.get()
            on:input:target=move |ev| set_input.set(ev.target().value())
            placeholder="ctrl+enter to submit"
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
        <button on:click=move |_| spawn_local(async move {
            submit(
                    api_key.get_untracked(),
                    system_prompt.get_untracked(),
                    messages.get_untracked(),
                    input.get_untracked(),
                    |new_input| set_input.set(new_input),
                    |new_messages| set_messages.set(new_messages),
                )
                .await;
        })>"Submit"</button>
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
