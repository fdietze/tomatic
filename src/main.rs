#![feature(async_closure)]

mod llm;

use leptos::{prelude::*, task::spawn_local};

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
    let (api_key, set_api_key) = signal("".to_string());

    view! {
        <div>
        <input type="text"
            prop:value=move || api_key.get()
            on:input:target=move |ev| set_api_key.set(ev.target().value())
            placeholder="OPENAI_API_KEY"
        />
        </div>

        <div>
            {move || {
                messages
                    .get()
                    .into_iter()
                    .map(|message| view! { <div><div style:opacity="0.5">{message.role}</div><pre>{message.content}</pre></div> })
                    .collect_view()
            }}
        </div>
        <textarea
            prop:value=move || input.get()
            on:input:target=move |ev| set_input.set(ev.target().value())
        >
            {input.get_untracked()}
        </textarea>
        <button on:click=move |_ | spawn_local(async move {
            let mut new_messages = messages.get();
                let user_message = Message { role: "user".to_string(), content : input.get()};
            new_messages.push(user_message);
            set_input.set("".to_string());
            let assistant_content = llm::request_str(new_messages.iter().map(|m| m.to_llm()).collect(), api_key.get());
            let assistant_message = Message { role: "assistant".to_string(), content : assistant_content.await.unwrap()};
                new_messages.push(assistant_message);
            set_messages.set(new_messages);
        })>"Submit"</button>
    }
}
