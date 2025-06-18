mod chat;
mod combobox;
mod copy_button;
mod dom_utils;
mod llm;
mod settings;

use crate::chat::{Message, SystemPrompt, SystemPromptBar};
use codee::string::JsonSerdeCodec;
use leptos::prelude::*;
use leptos_use::storage::use_local_storage;
use serde::{Deserialize, Serialize};

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

    // State lifted from ChatInterface or needed for new header items
    let (messages, set_messages, _) = use_local_storage::<Vec<Message>, JsonSerdeCodec>("messages");
    let (system_prompts, _, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");
    let (selected_prompt_name, set_selected_prompt_name, _) =
        use_local_storage::<Option<String>, JsonSerdeCodec>("selected_prompt_name");
    let (error, set_error) = signal::<Option<String>>(None);

    view! {
        <header>
            <SystemPromptBar
                system_prompts=system_prompts
                selected_prompt_name=selected_prompt_name
                set_selected_prompt_name=set_selected_prompt_name
            />
            <button
                data-role="primary"
                data-size="compact"
                on:click=move |_| {
                    set_messages(vec![]);
                    set_error(None);
                    set_page.set(Page::Chat);
                }
                // Adjust styling as needed, this was from the original button
                style:margin-left="auto"
            >
                "New Chat"
            </button>
            <button
                data-size="compact"
                on:click=move |_| set_page.set(Page::Chat)
                // Add some spacing
                style:margin-left="4px"
            >
                Chat
            </button>
            <button data-size="compact" on:click=move |_| set_page.set(Page::Settings)>
                Settings
            </button>
        </header>
        {move || match page.get() {
            Page::Chat => {
                view! {
                    <chat::ChatInterface
                        messages=messages
                        set_messages=set_messages
                        system_prompts=system_prompts
                        selected_prompt_name=selected_prompt_name
                        set_selected_prompt_name=set_selected_prompt_name
                        error=error
                        set_error=set_error
                    />
                }
                    .into_any()
            }
            Page::Settings => view! { <settings::Settings /> }.into_any(),
        }}
    }
}
