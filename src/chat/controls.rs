use leptos::{html, prelude::*};

#[component]
pub fn ChatControls(
    #[prop(into)] input: Signal<String>,
    #[prop(into)] set_input: WriteSignal<String>,
    #[prop(into)] input_disabled: Signal<bool>,
    #[prop(into)] ref_input: NodeRef<html::Textarea>,
    #[prop(into)] submit: Callback<Option<String>>,
    #[prop(into)] cancel_action: Callback<()>,
    #[prop(into)] is_mobile: Signal<bool>,
) -> impl IntoView {
    let on_keydown = move |ev: web_sys::KeyboardEvent| {
        if ev.key() != "Enter" {
            return;
        }

        if is_mobile.get() || ev.shift_key() {
            return;
        }

        if !input_disabled.get() {
            ev.prevent_default();
            submit.run(None);
        }
    };
    view! {
        <chat-controls>
            <form on:submit=move |ev| {
                ev.prevent_default();
                if !input_disabled.get() {
                    submit.run(None);
                }
            }>
                <div style="display:flex; padding-left: 4px; padding-right: 4px; padding-bottom: 4px; gap: 4px;">
                    <textarea
                        prop:value=input
                        on:input:target=move |ev| set_input(ev.target().value())
                        placeholder="Message"
                        node_ref=ref_input
                        on:keydown:target=move |ev| {
                            if ev.key() == "Enter" && !ev.shift_key() && !input_disabled.get() {
                                ev.prevent_default();
                                submit.run(None);
                            }
                        }
                        on:keydown=on_keydown
                        disabled=input_disabled
                    />
                    {move || {
                        if input_disabled.get() {
                            view! {
                                <button
                                    type="button"
                                    data-role="destructive"
                                    style="flex-shrink:0"
                                    on:click=move |_| cancel_action.run(())
                                >
                                    <span class="spinner"></span>
                                    "Cancel"
                                </button>
                            }
                                .into_any()
                        } else {
                            view! {
                                <button
                                    type="submit"
                                    data-role="primary"
                                    style="flex-shrink:0"
                                    disabled=input.get().is_empty() || input_disabled.get()
                                >
                                    "Go"
                                </button>
                            }
                                .into_any()
                        }
                    }}
                </div>
            </form>
        </chat-controls>
    }
}