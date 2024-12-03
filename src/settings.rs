use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::{html, prelude::*, task::spawn_local};
use leptos_use::storage::use_local_storage;

#[component]
pub fn Settings() -> impl IntoView {
    let (api_key, set_api_key, _) =
        use_local_storage::<String, FromToStringCodec>("OPENAI_API_KEY");
    let (system_prompt, set_system_prompt, _) =
        use_local_storage::<String, FromToStringCodec>("system_prompt");

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
            <settings-label>"system prompt:"</settings-label>
            <textarea
                prop:value=move || system_prompt.get()
                on:input:target=move |ev| set_system_prompt.set(ev.target().value())
                placeholder="system prompt"
                style:height="200px"
            />
        </settings-section>
    }
}
