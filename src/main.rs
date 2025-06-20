mod chat;
mod combobox;
mod copy_button;
mod dom_utils;
mod llm;
mod settings;
mod persistence;

use crate::chat::{Message, SystemPrompt, SystemPromptBar, ChatInterface};
use crate::llm::DisplayModelInfo;
use crate::persistence::ChatSession;
use crate::settings::Settings;
use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::ev::MouseEvent;
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_use::storage::use_local_storage;
use leptos_use::use_debounce_fn_with_arg;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use web_sys::js_sys::Date;

fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(App);
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Default)]
enum Page {
    #[default]
    Chat,
    Settings,
}

#[component]
fn App() -> impl IntoView {
    let (page, set_page, _) = use_local_storage::<Page, JsonSerdeCodec>("page");

    // --- LIFTED STATE ---
    // All use_local_storage calls for shared state are now in the top-level App component.
    let (api_key, set_api_key, _) =
        use_local_storage::<String, FromToStringCodec>("OPENROUTER_API_KEY");
    let (system_prompts, set_system_prompts, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");
    let (model_name_storage, set_model_name_storage, _) =
        use_local_storage::<String, FromToStringCodec>("MODEL_NAME");
    let (cached_models, set_cached_models, _) =
        use_local_storage::<Vec<DisplayModelInfo>, JsonSerdeCodec>("cached_models");
    // LIFTED STATE FOR CHAT INPUT to fix panic
    let (input, set_input, _) = use_local_storage::<String, FromToStringCodec>("input");

    // --- Session Navigation State ---
    let sorted_session_ids = RwSignal::new(Vec::<String>::new());
    let current_session_index = RwSignal::new(None::<usize>);

    // --- Current Session State (managed in App, persisted to IndexedDB) ---
    let current_session_id = RwSignal::new(String::new());
    let messages = RwSignal::new(Vec::<Message>::new());
    let selected_prompt_name = RwSignal::new(None::<String>);
    let error = RwSignal::new(None::<String>);

    // --- Actions ---
    let load_session_list = StoredValue::new(move || {
        spawn_local(async move {
            match persistence::get_all_session_keys_sorted_by_update().await {
                Ok(keys) => {
                    let current_id = current_session_id.get_untracked();
                    let new_index = keys.iter().position(|k| *k == current_id);
                    leptos::logging::log!("[LOG] [App] load_session_list: current_id='{}', new_index={:?}, new_keys={:?}", current_id, new_index, keys);
                    sorted_session_ids.set(keys);
                    current_session_index.set(new_index);
                }
                Err(e) => {
                    leptos::logging::log!("[ERROR] [App] Failed to load session list: {:?}", e);
                    error.set(Some(format!("Failed to load session list: {e}")));
                }
            }
        })
    });

    let load_session = StoredValue::new(move |session_id_to_load: String| {
        leptos::logging::log!("[LOG] [App] load_session: Starting for id '{}'", session_id_to_load);
        spawn_local(async move {
            match persistence::load_session(&session_id_to_load).await {
                Ok(Some(session)) => {
                    let new_index = sorted_session_ids
                        .get_untracked()
                        .iter()
                        .position(|id| *id == session.session_id);

                    // Use untracked updates to prevent triggering the save effect
                    current_session_id.update_untracked(|v| *v = session.session_id);
                    messages.update_untracked(|v| *v = session.messages);
                    selected_prompt_name.update_untracked(|v| *v = None);
                    error.update_untracked(|v| *v = None);

                    // These should trigger re-renders for navigation and page view
                    current_session_index.set(new_index);
                    set_page.set(Page::Chat);
                }
                Ok(None) => {
                    let msg = format!("Session {session_id_to_load} not found.");
                    leptos::logging::log!("[ERROR] [App] Tried to load session but failed: {}", msg);
                    error.set(Some(msg));
                }
                Err(e) => {
                    let msg = format!("Error loading session: {e}");
                    leptos::logging::log!("[ERROR] [App] {}", msg);
                    error.set(Some(msg));
                }
            }
            leptos::logging::log!("[LOG] [App] load_session: Finished for id '{}'", session_id_to_load);
        });
    });

    let create_new_session = StoredValue::new(move || {
        let new_id = Uuid::new_v4().to_string();
        leptos::logging::log!("[App] Creating new blank session: {}", new_id);
        current_session_id.set(new_id);
        messages.set(vec![]);
        selected_prompt_name.set(None);
        error.set(None);
        current_session_index.set(None);
        leptos::logging::log!("[App] Setting page to Chat for new session. Current page is: {:?}", page.get_untracked());
        set_page.set(Page::Chat);
        leptos::logging::log!("[App] New session creation complete.");
    });

    Effect::new(move |prev: Option<()>| {
        leptos::logging::log!("[App] Initial setup Effect running. Is rerun: {}", prev.is_some());
        load_session_list.get_value()();
        create_new_session.get_value()();
        leptos::logging::log!("[App] Initial setup Effect finished.");
    });

    let debounced_save_session = use_debounce_fn_with_arg(
        move |(session_id_to_save, msgs_to_save): (String, Vec<Message>)| {
            if session_id_to_save.is_empty() || msgs_to_save.is_empty() {
                return;
            }
            spawn_local(async move {
                leptos::logging::log!("[LOG] [App] Debounced save running for session: {}", session_id_to_save);
                match persistence::load_session(&session_id_to_save).await {
                    Ok(existing_session_opt) => {
                        let created_at = existing_session_opt
                            .map(|s| s.created_at_ms)
                            .unwrap_or_else(Date::now);
                        let session_to_save_db = ChatSession {
                            session_id: session_id_to_save.clone(),
                            messages: msgs_to_save,
                            name: None,
                            created_at_ms: created_at,
                            updated_at_ms: Date::now(),
                        };
                        if let Err(e) = persistence::save_session(&session_to_save_db).await {
                            leptos::logging::log!("[ERROR] [App] Error saving session {} (debounced): {:?}", session_id_to_save, e);
                        } else {
                            leptos::logging::log!("[LOG] [App] Session {} saved successfully (debounced). Triggering load_session_list.", session_id_to_save);
                            load_session_list.get_value()();
                        }
                    }
                    Err(e) => {
                        leptos::logging::log!("[ERROR] [App] Error loading session {} before debounced save: {:?}", session_id_to_save, e);
                    }
                }
            });
        },
        2000.0,
    );

    Effect::new(move |_| {
        let id = current_session_id.get();
        let msgs = messages.get();
        leptos::logging::log!("[LOG] [App] Save Effect triggered. session_id='{}', message_count={}", id, msgs.len());
        if !id.is_empty() && !msgs.is_empty() {
            leptos::logging::log!("[LOG] [App] Save Effect: Conditions met, calling debounced_save_session.");
            debounced_save_session((id, msgs));
        }
    });

    let can_go_prev = Memo::new(move |_| {
        match current_session_index.get() {
            Some(idx) => idx + 1 < sorted_session_ids.get().len(),
            None => !sorted_session_ids.get().is_empty(),
        }
    });

    let can_go_next = Memo::new(move |_| {
        match current_session_index.get() {
            Some(idx) => idx > 0,
            None => false,
        }
    });

    let on_prev = move |_: MouseEvent| {
        let ids = sorted_session_ids.get();
        if ids.is_empty() { return; }
        let current_idx_val = current_session_index.get();
        let new_index = match current_idx_val {
            Some(idx) => idx + 1,
            None => 0,
        };
        leptos::logging::log!("[LOG] [App] on_prev: current_index={:?}, new_index={}", current_idx_val, new_index);
        if new_index < ids.len() {
            load_session.get_value()(ids[new_index].clone());
        }
    };

    let on_next = move |_: MouseEvent| {
        if let Some(idx) = current_session_index.get() {
            if idx > 0 {
                let ids = sorted_session_ids.get();
                let new_index = idx - 1;
                load_session.get_value()(ids[new_index].clone());
            }
        }
    };

    view! {
        <header>
            <SystemPromptBar
                system_prompts=system_prompts
                selected_prompt_name=selected_prompt_name.read_only()
                set_selected_prompt_name=selected_prompt_name.write_only()
            />
            <button
                data-size="compact"
                on:click=on_prev
                disabled=move || !can_go_prev.get()
                style:margin-left="auto"
            >
                "Prev"
            </button>
            <button data-size="compact" on:click=on_next disabled=move || !can_go_next.get()>
                "Next"
            </button>
            <button
                data-role="primary"
                data-size="compact"
                on:click=move |_| {
                    let old_session_id = current_session_id.get_untracked();
                    let old_messages = messages.get_untracked();
                    if !old_session_id.is_empty() && !old_messages.is_empty() {
                        spawn_local(async move {
                            match persistence::load_session(&old_session_id).await {
                                Ok(existing_session_opt) => {
                                    let created_at = existing_session_opt
                                        .map(|s| s.created_at_ms)
                                        .unwrap_or_else(Date::now);
                                    let session_to_save = ChatSession {
                                        session_id: old_session_id.clone(),
                                        messages: old_messages,
                                        name: None,
                                        created_at_ms: created_at,
                                        updated_at_ms: Date::now(),
                                    };
                                    if let Err(e) = persistence::save_session(&session_to_save)
                                        .await
                                    {
                                        leptos::logging::log!(
                                            "[ERROR] [App] Error saving old session {}: {:?}", old_session_id, e
                                        );
                                    } else {
                                        leptos::logging::log!(
                                            "[App] Old session {} saved successfully.", old_session_id
                                        );
                                        load_session_list.get_value()();
                                    }
                                }
                                Err(e) => {
                                    leptos::logging::log!(
                                        "[ERROR] [App] Error loading old session {} before saving: {:?}", old_session_id, e
                                    );
                                }
                            }
                        });
                    }
                    create_new_session.get_value()();
                }
            >
                "New Chat"
            </button>
            <button
                data-size="compact"
                on:click=move |_| set_page.set(Page::Chat)
                style:margin-left="4px"
            >
                "Chat"
            </button>
            <button data-size="compact" on:click=move |_| set_page.set(Page::Settings)>
                "Settings"
            </button>
        </header>
        {move || {
            leptos::logging::log!("[App] View re-rendering. Current page is: {:?}", page.get());
            match page.get() {
                Page::Chat => {
                    view! {
                        <ChatInterface
                            messages=messages.read_only()
                            set_messages=messages.write_only()
                            system_prompts=system_prompts
                            selected_prompt_name=selected_prompt_name.read_only()
                            set_selected_prompt_name=selected_prompt_name.write_only()
                            error=error.read_only()
                            set_error=error.write_only()
                            // Pass lifted state down
                            api_key=api_key
                            model_name=model_name_storage
                            set_model_name=set_model_name_storage
                            input=input
                            set_input=set_input
                            cached_models=cached_models
                            set_cached_models=set_cached_models
                        />
                    }
                        .into_any()
                }
                Page::Settings => {
                    view! {
                        <Settings
                            // Pass lifted state down
                            api_key=api_key
                            set_api_key=set_api_key
                            system_prompts=system_prompts
                            set_system_prompts=set_system_prompts
                        />
                    }
                        .into_any()
                }
            }
        }}
    }
}
