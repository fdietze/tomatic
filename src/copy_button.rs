use leptos::logging::log;
use leptos::{prelude::*, task::spawn_local};
use leptos_use::use_timeout_fn;
use wasm_bindgen_futures::JsFuture;

pub const COPY_LABEL: &str = "copy";
pub const COPIED_LABEL: &str = "copied";
pub const ERROR_LABEL: &str = "failed";
pub const FEEDBACK_DURATION_MS: u32 = 1500;

#[component]
pub fn CopyButton(#[prop(into)] text_to_copy: Signal<String>) -> impl IntoView {
    let (button_text, set_button_text) = signal(COPY_LABEL.to_string());

    // `use_timeout_fn` returns a struct containing the controls.
    let timeout_controls = use_timeout_fn(
        // The callback must accept one argument.
        move |_| {
            set_button_text.set(COPY_LABEL.to_string());
        },
        FEEDBACK_DURATION_MS as f64,
    );

    let on_copy = move |_event: web_sys::MouseEvent| {
        let current_text_to_copy = text_to_copy.get_untracked();
        if current_text_to_copy.is_empty() {
            return;
        }

        // The clipboard API may not be available in all contexts (e.g. non-secure http).
        // `window().navigator().clipboard()` returns a `Clipboard` object which can be `undefined`.
        // We wrap it in an `Option` and filter it to handle this case gracefully.
        if let Some(clipboard) =
            Some(window().navigator().clipboard()).filter(|c| !c.is_undefined())
        {
            let promise = clipboard.write_text(&current_text_to_copy);

            // Clone the timeout controls to move into the async block.
            let start = timeout_controls.start.clone();
            let stop = timeout_controls.stop.clone();

            spawn_local(async move {
                match JsFuture::from(promise).await {
                    Ok(_) => {
                        stop();
                        set_button_text.set(COPIED_LABEL.to_string());
                        // The `start` function from `use_timeout_fn` takes an argument.
                        // Since our closure is `move |_|`, the argument type is `()`.
                        start(());
                    }
                    Err(e) => {
                        log!("[ERROR] CopyButton: Error copying to clipboard: {:?}", e);
                        stop();
                        set_button_text.set(ERROR_LABEL.to_string());
                        start(());
                    }
                }
            });
        } else {
            log!("[ERROR] CopyButton: Clipboard API not available or not in secure context.");
            // The fields `start` and `stop` are closures and must be called with parentheses.
            (timeout_controls.stop)();
            set_button_text.set(ERROR_LABEL.to_string());
            (timeout_controls.start)(());
        }
    };

    view! {
        <button class="copy-button" data-size="compact" on:click=on_copy>
            {move || button_text.get()}
        </button>
    }
}
