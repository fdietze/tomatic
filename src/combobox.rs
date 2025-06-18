use leptos::html::{Div, Input, Ul};
use web_sys::HtmlElement;
use leptos::prelude::*;
use leptos_use::on_click_outside;
use web_sys::KeyboardEvent;
use wasm_bindgen::JsCast;

const MIN_QUERY_LENGTH: usize = 1;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ComboboxItem {
    pub id: String,
    pub display_text: String, // Text to show in the dropdown, can be different from id
}

#[component]
pub fn Combobox(
    #[prop(optional, into)] id_prop: Option<String>,
    #[prop(into)] items: Signal<Vec<ComboboxItem>>,
    #[prop(into)] selected_id: Signal<String>,
    #[prop(into)] on_select: Callback<String>,
    #[prop(optional, into)] placeholder: Signal<String>,
    #[prop(optional, into)] disabled: Signal<bool>,
    #[prop(optional, into)] loading: Signal<bool>,
    #[prop(optional, into)] error_message: Signal<Option<String>>,
    #[prop(optional, into)] label: Option<String>,
) -> impl IntoView {
    let initial_query = selected_id.get_untracked();
    let search_query = RwSignal::new(initial_query);
    let show_suggestions = RwSignal::new(false);
    let highlighted_index = RwSignal::new(None::<usize>);

    let combobox_wrapper_ref = NodeRef::<Div>::new();
    let input_ref = NodeRef::<Input>::new();
    let suggestions_list_ref = NodeRef::<Ul>::new();

    // Effect to update internal search_query when external selected_id changes
    Effect::new(move |_| {
        let current_selected_id = selected_id.get();
        // Only update if it's different, to avoid potential loops if on_select
        // immediately updates selected_id which then feeds back here.
        if search_query.get_untracked() != current_selected_id {
            search_query.set(current_selected_id);
        }
    });

    // Close suggestions when clicking outside
    let _ = on_click_outside(combobox_wrapper_ref, move |_| {
        show_suggestions.set(false);
        highlighted_index.set(None);
    });

    let filtered_items = Memo::new(move |_| {
        let query = search_query.get().to_lowercase();
        if query.is_empty() || query.len() < MIN_QUERY_LENGTH {
            return vec![];
        }

        let search_terms: Vec<String> = query.split_whitespace().map(String::from).collect();
        // If the query was just whitespace, search_terms might be empty.
        // Or if MIN_QUERY_LENGTH > 0 and query consists only of whitespace
        // this check might be useful, although the MIN_QUERY_LENGTH check above
        // should mostly cover it.
        if search_terms.is_empty() {
            return vec![];
        }

        items.get()
            .into_iter()
            .filter(|item| {
                let item_id_lower = item.id.to_lowercase();
                let item_display_lower = item.display_text.to_lowercase();
                search_terms.iter().all(|term| {
                    item_id_lower.contains(term) || item_display_lower.contains(term)
                })
            })
            .collect::<Vec<ComboboxItem>>()
    });

    let handle_select_item = move |item: ComboboxItem| {
        search_query.set(item.id.clone());
        on_select.run(item.id);
        show_suggestions.set(false);
        highlighted_index.set(None);
        if let Some(input_el) = input_ref.get() {
            let _ = input_el.focus(); // Keep focus on input after selection
        }
    };

    let scroll_highlighted_item_into_view = move || {
        if let (Some(list_el), Some(idx)) = (suggestions_list_ref.get(), highlighted_index.get_untracked()) {
            if let Some(item_node) = list_el.children().item(idx as u32) {
                if let Ok(item_el) = item_node.dyn_into::<HtmlElement>() {
                    let list_scroll_top = list_el.scroll_top();
                    let list_client_height = list_el.client_height();
                    let item_offset_top = item_el.offset_top();
                    let item_offset_height = item_el.offset_height();

                    let item_is_above_visible_area = item_offset_top < list_scroll_top;
                    let item_is_below_visible_area = item_offset_top + item_offset_height > list_scroll_top + list_client_height;

                    if item_is_above_visible_area {
                        list_el.set_scroll_top(item_offset_top);
                    } else if item_is_below_visible_area {
                        list_el.set_scroll_top(item_offset_top + item_offset_height - list_client_height);
                    }
                }
            }
        }
    };

    let handle_input = move |ev: web_sys::Event| {
        let new_value = event_target_value(&ev);
        search_query.set(new_value.clone());
        if new_value.len() >= MIN_QUERY_LENGTH && !filtered_items.get_untracked().is_empty() {
            show_suggestions.set(true);
        } else {
            show_suggestions.set(false);
        }
        highlighted_index.set(None); // Reset highlight on new input
    };

    let handle_focus = move |_ev: web_sys::FocusEvent| {
        if search_query.get().len() >= MIN_QUERY_LENGTH && !filtered_items.get_untracked().is_empty() {
            show_suggestions.set(true);
        }
    };

    // Note: on:blur on the input itself can be problematic as it fires before
    // the click on a suggestion. on_click_outside handles general cases.
    // If specific on_blur logic for input is needed, it must be handled carefully.

    let handle_keydown = move |ev: KeyboardEvent| {
        if !show_suggestions.get() && ev.key() != "Enter" { // Allow Enter to try selecting even if not shown
            if ev.key() == "ArrowDown" || ev.key() == "ArrowUp" {
                if search_query.get().len() >= MIN_QUERY_LENGTH && !filtered_items.get_untracked().is_empty() {
                    show_suggestions.set(true); // Open suggestions if user tries to navigate
                } else {
                    return;
                }
            } else {
                return;
            }
        }


        match ev.key().as_str() {
            "ArrowDown" => {
                ev.prevent_default();
                let num_items = filtered_items.get().len();
                if num_items == 0 { return; }
                highlighted_index.update(|h_idx| {
                    match *h_idx {
                        Some(i) => *h_idx = Some((i + 1) % num_items),
                        None => *h_idx = Some(0),
                    }
                });
                scroll_highlighted_item_into_view();
            }
            "ArrowUp" => {
                ev.prevent_default();
                let num_items = filtered_items.get().len();
                if num_items == 0 { return; }
                highlighted_index.update(|h_idx| {
                    match *h_idx {
                        Some(i) => *h_idx = Some((i + num_items - 1) % num_items),
                        None => *h_idx = Some(num_items - 1),
                    }
                });
                scroll_highlighted_item_into_view();
            }
            "Enter" => {
                ev.prevent_default();
                let current_filtered = filtered_items.get_untracked();
                let current_highlighted = highlighted_index.get_untracked();

                if let Some(idx) = current_highlighted {
                    if idx < current_filtered.len() {
                        handle_select_item(current_filtered[idx].clone());
                        return;
                    }
                }

                if current_filtered.len() == 1 {
                     handle_select_item(current_filtered[0].clone());
                     return;
                }
                
                // Fallback: if current input text exactly matches an item ID, select it
                let current_query = search_query.get_untracked();
                if !current_query.is_empty() {
                    if let Some(item_to_select) = items.get_untracked().into_iter().find(|item| item.id == current_query) {
                        handle_select_item(item_to_select);
                        return;
                    }
                }
                show_suggestions.set(false); // Close if Enter didn't select anything
            }
            "Escape" => {
                ev.prevent_default();
                show_suggestions.set(false);
                highlighted_index.set(None);
            }
            "Tab" => {
                show_suggestions.set(false);
                highlighted_index.set(None);
                // Allow default Tab behavior
            }
            _ => {}
        }
    };

    let base_input_class = "combobox-input";
    let disabled_class = "combobox-input-disabled";
    let loading_class = "combobox-input-loading"; // You might want specific loading styles

    view! {
        <div class="combobox-wrapper" node_ref=combobox_wrapper_ref id=id_prop>
            {label.map(|l| view! { <label class="combobox-label">{l}</label> })}
            <input
                type="text"
                class=move || {
                    format!(
                        "{} {} {}",
                        base_input_class,
                        if disabled.get() { disabled_class } else { "" },
                        if loading.get() { loading_class } else { "" },
                    )
                }
                node_ref=input_ref
                prop:value=move || search_query.get()
                on:input=handle_input
                on:focus=handle_focus
                on:keydown=handle_keydown
                placeholder=move || placeholder.get()
                disabled=move || disabled.get()
                aria-autocomplete="list"
                aria-expanded=move || show_suggestions.get().to_string()
                // Ensure this ID matches the list's ID
                aria-controls="combobox-suggestions-list"
            />
            // aria-activedescendant: Would need to set IDs on list items

            {move || {
                if loading.get() {
                    view! { <div class="combobox-loading-indicator">"Loading..."</div> }.into_any()
                } else if let Some(err_msg) = error_message.get() {
                    view! { <div class="combobox-error-message">{err_msg}</div> }.into_any()
                } else if show_suggestions.get() && !filtered_items.get().is_empty() {
                    view! {
                        <ul
                            class="combobox-suggestions"
                            id="combobox-suggestions-list"
                            role="listbox"
                            node_ref=suggestions_list_ref
                        >
                            <For
                                each=move || filtered_items.get().into_iter().enumerate()
                                key=|(_, item)| item.id.clone()
                                children=move |(idx, item)| {
                                    let item_clone = item.clone();
                                    let item_clone_for_click = item.clone();
                                    let is_highlighted = Memo::new(move |_| {
                                        highlighted_index.get() == Some(idx)
                                    });
                                    view! {
                                        <li
                                            class="combobox-item"
                                            class:combobox-item-highlighted=is_highlighted
                                            role="option"
                                            aria-selected=move || is_highlighted.get().to_string()
                                            // id=format!("combobox-item-{}", item.id) // For aria-activedescendant
                                            // Mousedown fires before input blur
                                            on:mousedown=move |ev| {
                                                ev.prevent_default();
                                                handle_select_item(item_clone_for_click.clone());
                                            }
                                        >
                                            // Display text could be different from ID
                                            // For model selection, item.id is what we want in the input.
                                            // item.display_text could show "Model Name (ID: actual_id)"
                                            {item_clone.display_text}
                                        </li>
                                    }
                                }
                            />
                        </ul>
                    }
                        .into_any()
                } else if show_suggestions.get() && !search_query.get().is_empty()
                    && filtered_items.get().is_empty()
                {
                    view! { <div class="combobox-no-results">"No results found"</div> }.into_any()
                } else {
                    let _: () = // Empty fragment for no suggestions/error/loading
                    view! { <></> };
                    ().into_any()
                }
            }}
        </div>
    }
}