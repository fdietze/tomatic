pub mod system_prompt;

use crate::chat::types::SystemPrompt;
use crate::settings::system_prompt::SystemPromptItem;
use leptos::prelude::*;

#[derive(Clone)]
pub struct SettingsContext {
    pub editing_index: RwSignal<Option<usize>>,
}

#[component]
pub fn Settings(
    #[prop(into)] api_key: Signal<String>,
    #[prop(into)] set_api_key: WriteSignal<String>,
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] set_system_prompts: WriteSignal<Vec<SystemPrompt>>,
) -> impl IntoView {
    let editing_index = RwSignal::new(None::<usize>);
    provide_context(SettingsContext { editing_index });

    let on_new = move |_| {
        set_system_prompts.update(|items| {
            items.insert(0, SystemPrompt::default());
        });
        editing_index.set(Some(0));
    };

    view! {
        <div style:margin-bottom="50px">
            <settings-section>
                <settings-label>"OPENROUTER_API_KEY"</settings-label>
                <input
                    type="text"
                    prop:value=move || api_key.get()
                    on:input:target=move |ev| set_api_key.set(ev.target().value())
                    placeholder="OPENROUTER_API_KEY"
                />
            </settings-section>
            <settings-section>
                <settings-label>"system prompts"</settings-label>
                <button
                    data-role="primary"
                    data-size="compact"
                    on:click=on_new
                    style:margin-bottom="20px"
                >
                    "New"
                </button>
                <div class="system-prompt-list">
                    {move || {
                        system_prompts
                            .get()
                            .iter()
                            .enumerate()
                            .map(|(index, value)| {
                                let value = value.clone();
                                view! {
                                    <SystemPromptItem
                                        index=index
                                        value=value
                                        set_system_prompts=set_system_prompts
                                    />
                                }
                            })
                            .collect_view()
                    }}
                </div>
            </settings-section>
        </div>
    }
}
