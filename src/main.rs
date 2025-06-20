mod chat;
mod combobox;
mod copy_button;
mod dom_utils;
mod llm;
mod settings;
mod persistence;

use crate::chat::{Message, SystemPrompt, SystemPromptBar};
use crate::persistence::ChatSession; // Added persistence, removed 'self'
use codee::string::JsonSerdeCodec;
use leptos::prelude::*;
use leptos::task::spawn_local; // For spawning async tasks
use leptos_use::storage::use_local_storage;
use leptos_use::use_debounce_fn_with_arg; // For debounced saving
use serde::{Deserialize, Serialize};
use uuid::Uuid; // For generating session IDs
use web_sys::js_sys::Date; // For timestamps, corrected path for js_sys
// For debounce duration (removed as f64 is used now)

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

    // --- Persisted State (globally, not per session) ---
    let (system_prompts, _, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");
    // API Key and global model preference are handled in settings.rs and chat.rs respectively

    // --- Current Session State (managed in App, persisted to IndexedDB) ---
    let current_session_id = RwSignal::new(String::new()); // Initialized in Effect
    let messages = RwSignal::new(Vec::<Message>::new());
    // selected_prompt_name is the UI selection for the *next* interaction, managed in App for SystemPromptBar
    let selected_prompt_name = RwSignal::new(None::<String>); 
    let error = RwSignal::new(None::<String>); // For chat errors

    // Initialize the first session
    Effect::new(move |_| {
        let new_id = Uuid::new_v4().to_string();
        leptos::logging::log!("[App] Initializing new session: {}", new_id);
        current_session_id.set(new_id);
        // messages, selected_prompt_name are already default
    });

    // --- Debounced Save Logic ---
    let debounced_save_session = use_debounce_fn_with_arg(
        move |(session_id_to_save, msgs_to_save): (String, Vec<Message>)| {
            if session_id_to_save.is_empty() {
                leptos::logging::log!("[WARN] [App] Debounced save called with empty session_id, skipping.");
                return;
            }
            if msgs_to_save.is_empty() { // Simplified content check
                 leptos::logging::log!("[App] Debounced save: No messages for session {}, skipping.", session_id_to_save);
                return;
            }

            spawn_local(async move {
                leptos::logging::log!("[App] Debounced save triggered for session: {}", session_id_to_save);
                match persistence::load_session(&session_id_to_save).await {
                    Ok(existing_session_opt) => {
                        let created_at = existing_session_opt
                            .map(|s| s.created_at_ms)
                            .unwrap_or_else(Date::now);

                        let session_to_save_db = ChatSession {
                            session_id: session_id_to_save.clone(),
                            messages: msgs_to_save,
                            // selected_prompt_name and model_name are now part of Message struct
                            name: None, // Session naming not implemented yet
                            created_at_ms: created_at,
                            updated_at_ms: Date::now(),
                        };

                        if let Err(e) = persistence::save_session(&session_to_save_db).await {
                            leptos::logging::log!("[ERROR] [App] Error saving session {} (debounced): {:?}", session_id_to_save, e);
                            // Optionally set an error signal for the UI
                        } else {
                            leptos::logging::log!("[App] Session {} saved successfully (debounced).", session_id_to_save);
                        }
                    }
                    Err(e) => {
                        leptos::logging::log!("[ERROR] [App] Error loading session {} before debounced save: {:?}", session_id_to_save, e);
                    }
                }
            });
        },
        2000.0, // Debounce duration in ms (f64)
    );

    // Effect to trigger debounced save when session data changes (primarily messages)
    Effect::new(move |_| {
        let id = current_session_id.get();
        let msgs = messages.get();
        // selected_prompt_name change doesn't directly trigger session save, 
        // as it's for the *next* message. It gets saved as part of the message.

        // Only call if id is not empty (i.e., initialized)
        // And if there are messages to save.
        if !id.is_empty() && !msgs.is_empty() {
            debounced_save_session((id, msgs));
        }
    });


    view! {
        <header>
            <SystemPromptBar
                system_prompts=system_prompts
                selected_prompt_name=selected_prompt_name.read_only() // Pass ReadSignal
                set_selected_prompt_name=selected_prompt_name.write_only() // Pass WriteSignal
            />
            <button
                data-role="primary"
                data-size="compact"
                on:click=move |_| {
                    let old_session_id = current_session_id.get_untracked();
                    let old_messages = messages.get_untracked();
                    // old_selected_prompt and old_model_name are now part of messages themselves.

                    if !old_session_id.is_empty() && !old_messages.is_empty() { // Simplified condition
                        leptos::logging::log!("[App] New Chat clicked, saving old session: {}", old_session_id);
                        spawn_local(async move {
                            match persistence::load_session(&old_session_id).await {
                                Ok(existing_session_opt) => {
                                    let created_at = existing_session_opt
                                        .map(|s| s.created_at_ms)
                                        .unwrap_or_else(Date::now);

                                    let session_to_save = ChatSession {
                                        session_id: old_session_id.clone(),
                                        messages: old_messages,
                                        // selected_prompt_name and model_name removed from ChatSession
                                        name: None,
                                        created_at_ms: created_at,
                                        updated_at_ms: Date::now(),
                                    };
                                    if let Err(e) = persistence::save_session(&session_to_save).await {
                                        leptos::logging::log!("[ERROR] [App] Error saving old session {}: {:?}", old_session_id, e);
                                    } else {
                                        leptos::logging::log!("[App] Old session {} saved successfully.", old_session_id);
                                    }
                                }
                                Err(e) => {
                                     leptos::logging::log!("[ERROR] [App] Error loading old session {} before saving: {:?}", old_session_id, e);
                                }
                            }
                        });
                    }

                    // Start new session
                    let new_id = Uuid::new_v4().to_string();
                    leptos::logging::log!("[App] Creating new session: {}", new_id);
                    current_session_id.set(new_id);
                    messages.set(vec![]);
                    selected_prompt_name.set(None); // Reset UI selection for system prompt
                    // current_session_model_name signal removed
                    error.set(None);
                    set_page.set(Page::Chat); // Ensure chat page is active
                }
                // Adjust styling as needed, this was from the original button
                style:margin-left="auto"
            >
                "New Chat"
            </button>
            <button
                data-size="compact"
                on:click=move |_| set_page.set(Page::Chat)
                // Add some spacing
                style:margin-left="4px"
            >
                Chat
            </button>
            <button data-size="compact" on:click=move |_| set_page.set(Page::Settings)>
                Settings
            </button>
        </header>
        {move || match page.get() {
            Page::Chat => {
                view! {
                    <chat::ChatInterface
                        messages=messages.read_only() // Pass ReadSignal
                        set_messages=messages.write_only() // Pass WriteSignal
                        system_prompts=system_prompts // This is already a signal
                        selected_prompt_name=selected_prompt_name.read_only() // This is UI's selected prompt for next interaction
                        set_selected_prompt_name=selected_prompt_name.write_only() // This is UI's selected prompt for next interaction
                        // _current_session_model_name and set_current_session_model_name props removed
                        error=error.read_only()
                        set_error=error.write_only()
                    />
                }
                    .into_any()
            }
            Page::Settings => view! { <settings::Settings /> }.into_any(),
        }}
    }
}
