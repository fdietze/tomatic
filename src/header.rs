use leptos::prelude::*;
use leptos_router::hooks::{use_location, use_navigate};

use crate::state::GlobalState;

#[component]
pub fn Header() -> impl IntoView {
    let state = use_context::<GlobalState>().expect("state to have been provided");

    let on_chat = {
        let navigate = use_navigate();
        move |_| {
            if let Some(id) = state.current_session_id.get() {
                navigate(&format!("/chat/{id}"), Default::default());
            } else {
                navigate("/chat/new", Default::default());
            }
        }
    };

    let on_settings = {
        let navigate = use_navigate();
        move |_| {
            navigate("/settings", Default::default());
        }
    };

    let location = use_location();
    let is_chat_active = Memo::new(move |_| location.pathname.with(|p| p.starts_with("/chat")));
    let is_settings_active = Memo::new(move |_| location.pathname.with(|p| p.starts_with("/settings")));

    view! {
        <header>
            <div class="tabs">
                <button on:click=on_chat data-active=move || is_chat_active.get().to_string()>
                    "Chat"
                </button>
                <button
                    on:click=on_settings
                    data-active=move || is_settings_active.get().to_string()
                >
                    "Settings"
                </button>
            </div>
        </header>
    }
}