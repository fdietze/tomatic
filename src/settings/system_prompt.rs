use crate::chat::types::SystemPrompt;
use crate::settings::SettingsContext;
use leptos::{ev::MouseEvent, prelude::*};

#[component]
pub fn SystemPromptItem(
    index: usize,
    value: SystemPrompt,
    set_system_prompts: WriteSignal<Vec<SystemPrompt>>,
) -> impl IntoView {
    let is_editing = RwSignal::new(false);
    let editing_name = RwSignal::new(value.name.clone());
    let editing_prompt = RwSignal::new(value.prompt.clone());

    let settings = use_context::<SettingsContext>().unwrap();

    Effect::new(move |_| {
        if settings.editing_index.get() == Some(index) {
            is_editing.set(true);
            settings.editing_index.set(None);
        }
    });

    let turn_on_editing = {
        let value = value.clone();
        Callback::new(move |_: MouseEvent| {
            editing_name.set(value.name.clone());
            editing_prompt.set(value.prompt.clone());
            is_editing.set(true);
        })
    };

    let turn_off_editing = Callback::new(move |_: ()| {
        is_editing.set(false);
    });

    let on_save = {
        Callback::new(move |_: MouseEvent| {
            set_system_prompts.update(|prompts| {
                if let Some(prompt) = prompts.get_mut(index) {
                    prompt.name = editing_name.get_untracked();
                    prompt.prompt = editing_prompt.get_untracked();
                }
            });
            turn_off_editing.run(());
        })
    };

    let on_cancel = {
        Callback::new(move |_: MouseEvent| {
            turn_off_editing.run(());
        })
    };

    let on_remove = Callback::new(move |_: MouseEvent| {
        set_system_prompts.update(|prompts| {
            if index < prompts.len() {
                prompts.remove(index);
            }
        })
    });

    view! {
        <Show
            when=is_editing
            fallback=move || {
                view! {
                    <div class="system-prompt-item-view">
                        <span class="system-prompt-name">{value.name.clone()}</span>
                        <span class="system-prompt-text">{value.prompt.clone()}</span>
                        <div class="system-prompt-buttons">
                            <button on:click=move |ev| turn_on_editing.run(ev) data-size="compact">
                                "Edit"
                            </button>
                            <button on:click=move |ev| on_remove.run(ev) data-size="compact">
                                "Delete"
                            </button>
                        </div>
                    </div>
                }
            }
        >
            <div class="system-prompt-item-edit">
                <div class="system-prompt-inputs">
                    <input
                        type="text"
                        prop:value=editing_name
                        on:input:target=move |ev| editing_name.set(ev.target().value())
                        placeholder="name"
                    />
                    <textarea
                        prop:value=editing_prompt
                        on:input:target=move |ev| editing_prompt.set(ev.target().value())
                        placeholder="system prompt"
                    />
                </div>
                <div class="system-prompt-edit-buttons">
                    <button
                        on:click=move |ev| on_save.run(ev)
                        data-size="compact"
                        data-role="primary"
                    >
                        "Save"
                    </button>
                    <button on:click=move |ev| on_cancel.run(ev) data-size="compact">
                        "Cancel"
                    </button>
                </div>
            </div>
        </Show>
    }
}