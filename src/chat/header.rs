use leptos::{ev, prelude::*};
use leptos_router::hooks::use_navigate;

use crate::{chat::types::SystemPrompt, chat::SystemPromptBar};

#[component]
pub fn ChatHeader(
    system_prompts: Signal<Vec<SystemPrompt>>,
    selected_prompt_name: Signal<Option<String>>,
    set_selected_prompt_name: WriteSignal<Option<String>>,
    can_go_prev: Memo<bool>,
    can_go_next: Memo<bool>,
    on_prev: impl Fn(ev::MouseEvent) + Clone + 'static,
    on_next: impl Fn(ev::MouseEvent) + Clone + 'static,
) -> impl IntoView {
    let on_new_chat = {
        let navigate = use_navigate();
        move |_| {
            navigate("/chat/new", Default::default());
        }
    };

    view! {
        <div class="chat-header">
            <button data-size="compact" on:click=on_prev disabled=move || !can_go_prev.get()>
                "Prev"
            </button>
            <button
                data-size="compact"
                on:click=on_next
                disabled=move || !can_go_next.get()

                style:margin-right="auto"
            >
                "Next"
            </button>
            <SystemPromptBar
                system_prompts=system_prompts
                selected_prompt_name=selected_prompt_name
                set_selected_prompt_name=set_selected_prompt_name
            />
            <button data-role="primary" data-size="compact" on:click=on_new_chat>
                "New Chat"
            </button>
        </div>
    }
}

