use leptos::prelude::*;

use crate::chat::types::SystemPrompt;

#[component]
pub fn Settings(
    #[prop(into)] api_key: Signal<String>,
    #[prop(into)] set_api_key: WriteSignal<String>,
    #[prop(into)] system_prompts: Signal<Vec<SystemPrompt>>,
    #[prop(into)] set_system_prompts: WriteSignal<Vec<SystemPrompt>>,
) -> impl IntoView {
    let on_name_change = move |index: usize, new_value: String| {
        set_system_prompts.update(|items| {
            if let Some(item) = items.get_mut(index) {
                item.name = new_value;
            }
        });
    };

    let on_prompt_change = move |index: usize, new_value: String| {
        set_system_prompts.update(|items| {
            if let Some(item) = items.get_mut(index) {
                item.prompt = new_value;
            }
        });
    };

    view! {
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
                on:click=move |_| {
                    set_system_prompts
                        .update(|items| {
                            items.insert(0, SystemPrompt::default());
                        })
                }
                style:margin-bottom="20px"
            >

                "New"
            </button>
            {move || {
                system_prompts
                    .get()
                    .iter()
                    .enumerate()
                    .map(|(index, value)| {
                        let value = value.clone();
                        view! {
                            <settings-system-prompt>
                                <div>
                                    <input
                                        type="text"
                                        placeholder="name"
                                        prop:value=value.name
                                        on:input:target=move |ev| {
                                            let input_value = ev.target().value();
                                            on_name_change(index, input_value);
                                        }
                                        style:margin-bottom="4px"
                                    />
                                    <textarea
                                        placeholder="system prompt"
                                        prop:value=value.prompt
                                        on:input:target=move |ev| {
                                            let input_value = ev.target().value();
                                            on_prompt_change(index, input_value);
                                        }
                                    />
                                </div>
                                <button on:click=move |_| {
                                    set_system_prompts
                                        .update(|items| {
                                            items.remove(index);
                                        })
                                }>"Remove"</button>
                            </settings-system-prompt>
                        }
                    })
                    .collect_view()
            }}
        </settings-section>
    }
}
