use crate::chat::types::SystemPrompt;
use crate::chat::SystemPromptBar;
use leptos::prelude::*;
use leptos_router::hooks::use_navigate;
use leptos::ev;

#[component]
pub fn Header(
    system_prompts: Signal<Vec<SystemPrompt>>,
    selected_prompt_name: ReadSignal<Option<String>>,
    set_selected_prompt_name: WriteSignal<Option<String>>,
    can_go_prev: Memo<bool>,
    can_go_next: Memo<bool>,
    on_prev: impl Fn(ev::MouseEvent) + Clone + 'static,
    on_next: impl Fn(ev::MouseEvent) + Clone + 'static,
    global_state: crate::state::GlobalState,
) -> impl IntoView {
    let on_new_chat = {
        let navigate = use_navigate();
        move |_| {
            navigate("/chat/new", Default::default());
        }
    };

    let on_chat = {
        let navigate = use_navigate();
        move |_| {
            if let Some(id) = global_state.current_session_id.get() {
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

    view! {
        <header>
            <SystemPromptBar
                system_prompts=system_prompts
                selected_prompt_name=selected_prompt_name
                set_selected_prompt_name=set_selected_prompt_name
            />
            <button
                data-size="compact"
                on:click=on_prev
                disabled=move || !can_go_prev.get()
                style:margin-left="auto"
            >
                "Prev"
            </button>
            <button data-size="compact" on:click=on_next disabled=move || !can_go_next.get()>
                "Next"
            </button>
            <button data-role="primary" data-size="compact" on:click=on_new_chat>
                "New Chat"
            </button>
            <button data-size="compact" on:click=on_chat style:margin-left="4px">
                "Chat"
            </button>
            <button data-size="compact" on:click=on_settings>
                "Settings"
            </button>
        </header>
    }
}