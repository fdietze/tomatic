use leptos::ev::KeyboardEvent;
use leptos::prelude::*;

pub fn create_textarea_enter_handler(
    is_mobile: Signal<bool>,
    on_submit: Callback<()>,
) -> impl Fn(KeyboardEvent) {
    move |ev: KeyboardEvent| {
        if ev.key() != "Enter" {
            return;
        }

        if is_mobile.get() || ev.shift_key() {
            return;
        }

        ev.prevent_default();
        on_submit.run(());
    }
}
