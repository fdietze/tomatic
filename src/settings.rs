use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::prelude::*;
use leptos_use::storage::use_local_storage;

use crate::chat::SystemPrompt;

#[component]
pub fn Settings() -> impl IntoView {
    let (api_key, set_api_key, _) =
        use_local_storage::<String, FromToStringCodec>("OPENAI_API_KEY");
    let (system_prompts, set_system_prompts, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");

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
            <settings-label>"OPENAI_API_KEY"</settings-label>
            <input
                type="text"
                prop:value=move || api_key.get()
                on:input:target=move |ev| set_api_key.set(ev.target().value())
                placeholder="OPENAI_API_KEY"
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
                                        prop:value=value.prompt
                                        placeholder="system prompt"
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
