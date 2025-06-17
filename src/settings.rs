use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_use::storage::use_local_storage;

use crate::chat::SystemPrompt;
use crate::llm;

#[component]
pub fn Settings() -> impl IntoView {
    let (api_key, set_api_key, _) =
        use_local_storage::<String, FromToStringCodec>("OPENROUTER_API_KEY");
    let (model_name, set_model_name, _) =
        use_local_storage::<String, FromToStringCodec>("MODEL_NAME");
    let (system_prompts, set_system_prompts, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");

    let (fetched_models_result, set_fetched_models_result) =
        signal::<Option<Result<Vec<String>, String>>>(None);
    let (models_loading, set_models_loading) = signal(false);

    Effect::new(move |_| {
        let current_api_key = api_key(); // Depend on api_key signal
        if current_api_key.is_empty() {
            set_fetched_models_result(None);
            set_models_loading(false);
            return;
        }

        set_models_loading(true);
        // Clear previous results while loading new ones
        // set_fetched_models_result(None); // Optional: clear immediately or let the loading state suffice

        spawn_local(async move {
            let result = llm::list_available_models(current_api_key)
                .await
                .map_err(|e| e.to_string());
            set_fetched_models_result(Some(result));
            set_models_loading(false);
        });
    });

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
            <settings-label>"Model Name"</settings-label>
            {move || {
                if api_key.get().is_empty() {
                    view! { <p>"Enter API key to load models."</p> }.into_any()
                } else if models_loading.get() {
                    view! { <p>"Loading models..."</p> }.into_any()
                } else {
                    match fetched_models_result.get() {
                        Some(Ok(models)) => {
                            view! {
                                <select
                                    on:change=move |ev| {
                                        let new_value = event_target_value(&ev);
                                        set_model_name.set(new_value);
                                    }
                                >
                                    <option
                                        value=""
                                        selected=model_name.get().is_empty()
                                        disabled=true
                                    >
                                        "Select a model"
                                    </option>
                                    {models
                                        .into_iter()
                                        .map(|id| {
                                            let is_selected = model_name.get() == id;
                                            view! {
                                                <option value=id.clone() selected=is_selected>
                                                    {id.clone()}
                                                </option>
                                            }
                                        })
                                        .collect_view()}
                                </select>
                            }
                                .into_any()
                        }
                        Some(Err(e)) => {
                            view! { <p style="color: red;">"Error loading models: " {e.to_string()}</p> }.into_any()
                        }
                        None => {
                            // This state occurs if API key is present, not loading, but no results yet (e.g. initial state before first load completes)
                            // Or if the API key was just entered and the effect is about to trigger loading.
                            // An explicit "Loading..." or empty view might be fine here.
                            // Given models_loading handles explicit loading, this can be a quiet "no data" or placeholder.
                            view! { <p>"No models loaded or available."</p> }.into_any()
                        }
                    }
                }
            }}
            <input
                type="text"
                prop:value=move || model_name.get()
                on:input:target=move |ev| set_model_name.set(ev.target().value())
                placeholder="Or enter model manually (e.g., openai/gpt-4o)"
                style="margin-top: 5px;"
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
