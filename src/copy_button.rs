use gloo_timers::callback::Timeout;
use leptos::logging::log;
use leptos::{prelude::*, task::spawn_local};
use wasm_bindgen_futures::JsFuture;
use web_sys::Clipboard;

pub const COPY_LABEL: &str = "copy";
pub const COPIED_LABEL: &str = "copied";
pub const ERROR_LABEL: &str = "failed"; // Shorter error message for small button
pub const FEEDBACK_DURATION_MS: u32 = 1500;

#[component]
pub fn CopyButton(#[prop(into)] text_to_copy: Signal<String>) -> impl IntoView {
    let (button_text, set_button_text) = signal(COPY_LABEL.to_string());

    let on_copy = move |_event: web_sys::MouseEvent| {
        let current_text_to_copy = text_to_copy.get_untracked();
        if current_text_to_copy.is_empty() {
            // Silently do nothing if there's no text to copy
            return;
        }

        // Attempt to access the clipboard
        let clipboard_opt: Option<Clipboard> = Some(window().navigator().clipboard());

        if let Some(clipboard) = clipboard_opt {
            let promise = clipboard.write_text(&current_text_to_copy);
            spawn_local(async move {
                match JsFuture::from(promise).await {
                    Ok(_) => {
                        set_button_text(COPIED_LABEL.to_string());
                        Timeout::new(FEEDBACK_DURATION_MS, move || {
                            set_button_text(COPY_LABEL.to_string());
                        })
                        .forget(); // Important: `forget` to keep the timeout alive
                    }
                    Err(e) => {
                        log!("[ERROR] CopyButton: Error copying to clipboard: {:?}", e);
                        set_button_text(ERROR_LABEL.to_string());
                        Timeout::new(FEEDBACK_DURATION_MS, move || {
                            set_button_text(COPY_LABEL.to_string());
                        })
                        .forget();
                    }
                }
            });
        } else {
            // This case usually means the context is not secure (e.g., HTTP instead of HTTPS)
            // or the Clipboard API is not supported/enabled by the browser.
            log!("[ERROR] CopyButton: Clipboard API not available or not in secure context.");
            set_button_text(ERROR_LABEL.to_string());
            Timeout::new(FEEDBACK_DURATION_MS, move || {
                set_button_text(COPY_LABEL.to_string());
            })
            .forget();
        }
    };

    view! {
        <button class="copy-button" data-size="compact" on:click=on_copy>
            // Optionally disable the button if there's no text to copy:
            // prop:disabled=move || text_to_copy.get().is_empty()
            {move || button_text.get()}
        </button>
    }
}
