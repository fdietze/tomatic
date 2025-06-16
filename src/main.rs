

mod chat;
mod llm;
mod settings;

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
    view! {
        <header>
            <button
                data-role="outline"
                data-size="compact"
                on:click=move |_| set_page.set(Page::Chat)
            >
                Chat
            </button>
            <button
                data-role="outline"
                data-size="compact"
                on:click=move |_| set_page.set(Page::Settings)
            >
                Settings
            </button>
        </header>
        {move || match page.get() {
            Page::Chat => view! { <chat::ChatInterface /> }.into_any(),
            Page::Settings => view! { <settings::Settings /> }.into_any(),
        }}
    }
}
