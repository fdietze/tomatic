use super::textarea::create_textarea_enter_handler;
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
    view! {
        <chat-controls>
            <form on:submit=move |ev| {
                ev.prevent_default();
                if !input_disabled.get() {
                    submit.run(None);
                }
            }>
                <div style="display:flex; padding: 4px; gap: 4px;">
                    <textarea
                        prop:value=input
                        on:input:target=move |ev| set_input(ev.target().value())
                        placeholder="Message"
                        node_ref=ref_input
                        on:keydown=create_textarea_enter_handler(
                            is_mobile,
                            Callback::new(move |_| {
                                if !input_disabled.get() {
                                    submit.run(None);
                                }
                            }),
                        )
                        disabled=input_disabled
                    />

                    // HACK: This section works around a bug in Leptos's virtual DOM diffing.
                    // When conditionally rendering two different buttons in the same place,
                    // a boolean attribute (`disabled`) from one button can "bleed" over
                    // to the other when the view is swapped.
                    // A minimal reproduction of this bug has been created in `main.rs`.
                    // Once the bug is fixed in Leptos, this code can be simplified back
                    // to a single `if/else` or `move || if ...` block.
                    // The original implementation was:
                    // 
                    // {move || {
                    // if input_disabled.get() {
                    // view! { <button type="button" on:click=cancel_action>"Cancel"</button> }
                    // } else {
                    // view! { <button type="submit" disabled=input.get().is_empty()>"Go"</button> }
                    // }
                    // }}
                    <button
                        type="button"
                        data-role="destructive"
                        style="flex-shrink:0"
                        on:click=move |_| cancel_action.run(())
                        hidden=move || !input_disabled.get()
                    >
                        <span class="spinner"></span>
                        "Cancel"
                    </button>
                    <button
                        type="submit"
                        data-role="primary"
                        style="flex-shrink:0"
                        disabled=move || input.get().is_empty()
                        hidden=input_disabled
                    >
                        "Go"
                    </button>
                </div>
            </form>
        </chat-controls>
    }
}
