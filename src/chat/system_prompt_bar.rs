use leptos::prelude::*;

use super::types::SystemPrompt;

#[component]
pub fn SystemPromptBar(
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] selected_prompt_name: Signal<Option<String>>,
    #[prop(into)] set_selected_prompt_name: WriteSignal<Option<String>>,
) -> impl IntoView {
    view! {
        {move || {
            let selected_prompt_name = selected_prompt_name();
            system_prompts()
                .iter()
                .map(|system_prompt| {
                    let name = system_prompt.name.clone();
                    let selected = selected_prompt_name.clone() == Some(name.clone());
                    view! {
                        <button
                            data-size="compact"
                            data-role="outline"
                            class="chat-controls-system-prompt"
                            data-selected=selected.to_string()
                            on:click={
                                let selected_prompt_name = selected_prompt_name.clone();
                                move |_| {
                                    if selected_prompt_name == Some(name.clone()) {
                                        set_selected_prompt_name(None)
                                    } else {
                                        set_selected_prompt_name(Some(name.clone()))
                                    }
                                }
                            }
                        >
                            {name.clone()}
                        </button>
                    }
                })
                .collect_view()
        }}
    }
}
