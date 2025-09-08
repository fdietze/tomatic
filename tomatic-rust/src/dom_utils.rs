use gloo_timers::callback::Timeout;
use leptos::logging::log;
use leptos::prelude::{document, window};
use leptos::task::spawn_local;
use wasm_bindgen::{closure::Closure, JsCast};
use wasm_bindgen_futures::JsFuture;
use web_sys::{HtmlButtonElement, HtmlElement, HtmlPreElement, Node};

use crate::copy_button::{COPIED_LABEL, COPY_LABEL, ERROR_LABEL, FEEDBACK_DURATION_MS};

/// Sets the inner HTML of a target element and then enhances it by
/// adding copy buttons to all `<pre>` tags found within the new content.
pub fn set_html_content_with_copy_buttons(target_element: &HtmlElement, html_content: &str) {
    target_element.set_inner_html(html_content);

    let document = document();
    match target_element.query_selector_all("pre") {
        Ok(pre_elements) => {
            for i in 0..pre_elements.length() {
                if let Some(node) = pre_elements.item(i) {
                    if let Ok(pre_el) = node.dyn_into::<HtmlPreElement>() {
                        // Check if a copy button already exists to avoid duplicates
                        if pre_el
                            .query_selector(".copy-button")
                            .ok()
                            .flatten()
                            .is_some()
                        {
                            continue;
                        }

                        if let Ok(button_el_as_element) = document.create_element("button") {
                            if let Ok(button_el) =
                                button_el_as_element.dyn_into::<HtmlButtonElement>()
                            {
                                button_el.set_class_name("copy-button");
                                button_el.set_text_content(Some(COPY_LABEL));
                                // Add data-size="compact" attribute
                                let _ = button_el.set_attribute("data-size", "compact");

                                let pre_el_clone = pre_el.clone();
                                let button_el_clone_for_handler = button_el.clone();

                                let click_handler = Closure::wrap(Box::new(
                                    move |_event: web_sys::MouseEvent| {
                                        let text_to_copy = if let Ok(Some(code_node)) =
                                            pre_el_clone.query_selector("code")
                                        {
                                            code_node.text_content().unwrap_or_default()
                                        } else {
                                            // Fallback: get text content of pre, excluding the button itself
                                            let mut content = String::new();
                                            let children = pre_el_clone.child_nodes();
                                            for idx in 0..children.length() {
                                                if let Some(child_node) = children.item(idx) {
                                                    if let Some(btn_node_ref) =
                                                        button_el_clone_for_handler
                                                            .dyn_ref::<Node>()
                                                    {
                                                        if child_node
                                                            .is_same_node(Some(btn_node_ref))
                                                        {
                                                            continue;
                                                        }
                                                    }
                                                    content.push_str(
                                                        &child_node
                                                            .text_content()
                                                            .unwrap_or_default(),
                                                    );
                                                }
                                            }
                                            content.trim().to_string()
                                        };

                                        if !text_to_copy.is_empty() {
                                            if let Some(clipboard) =
                                                Some(window().navigator().clipboard())
                                                    .filter(|c| !c.is_undefined())
                                            {
                                                let promise = clipboard.write_text(&text_to_copy);
                                                let button_for_feedback =
                                                    button_el_clone_for_handler.clone();
                                                spawn_local(async move {
                                                    match JsFuture::from(promise).await {
                                                        Ok(_) => {
                                                            button_for_feedback.set_text_content(
                                                                Some(COPIED_LABEL),
                                                            );
                                                            let timeout_button =
                                                                button_for_feedback.clone();
                                                            Timeout::new(
                                                                FEEDBACK_DURATION_MS,
                                                                move || {
                                                                    timeout_button
                                                                        .set_text_content(Some(
                                                                            COPY_LABEL,
                                                                        ));
                                                                },
                                                            )
                                                            .forget();
                                                        }
                                                        Err(e) => {
                                                            log!("[DOM_UTILS] Error copying code block to clipboard: {:?}", e);
                                                            button_for_feedback.set_text_content(
                                                                Some(ERROR_LABEL),
                                                            );
                                                            let timeout_button =
                                                                button_for_feedback.clone();
                                                            Timeout::new(
                                                                FEEDBACK_DURATION_MS,
                                                                move || {
                                                                    timeout_button
                                                                        .set_text_content(Some(
                                                                            COPY_LABEL,
                                                                        ));
                                                                },
                                                            )
                                                            .forget();
                                                        }
                                                    }
                                                });
                                            } else {
                                                log!("[DOM_UTILS] Clipboard API not available or not in secure context for code block.");
                                                button_el_clone_for_handler
                                                    .set_text_content(Some("NoAPI")); // Short feedback for no API
                                                let btn_clone = button_el_clone_for_handler.clone();
                                                Timeout::new(FEEDBACK_DURATION_MS, move || {
                                                    btn_clone.set_text_content(Some(COPY_LABEL));
                                                })
                                                .forget();
                                            }
                                        }
                                    },
                                )
                                    as Box<dyn FnMut(_)>);

                                if button_el
                                    .add_event_listener_with_callback(
                                        "click",
                                        click_handler.as_ref().unchecked_ref(),
                                    )
                                    .is_ok()
                                {
                                    click_handler.forget(); // Leak the closure to keep it alive
                                    if pre_el.append_child(&button_el).is_err() {
                                        log!("[DOM_UTILS] Failed to append copy button to <pre> element.");
                                    }
                                } else {
                                    log!(
                                        "[DOM_UTILS] Failed to add click listener to copy button."
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        Err(e) => {
            log!(
                "[DOM_UTILS] Failed to querySelectorAll for pre elements: {:?}",
                e
            );
        }
    }
}
