mod chat;
mod chat_page;
mod combobox;
mod copy_button;
mod dom_utils;
mod header;
mod llm;
mod persistence;
mod state;
pub mod markdown;
mod settings;
pub mod utils;

use crate::chat::types::{Message, SystemPrompt};
use crate::header::Header;
use crate::chat_page::ChatPage;
use crate::llm::DisplayModelInfo;
use crate::persistence::ChatSession;
use crate::state::GlobalState;
use crate::settings::Settings;
use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::components::{Redirect, Route, Router, Routes};
use leptos_router::hooks::use_navigate;
use leptos_router::{path, NavigateOptions};
use leptos_use::storage::use_local_storage;
use leptos_use::use_debounce_fn;

use web_sys::js_sys::Date;


fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    view! {
        <Router>
            <MainContent />
        </Router>
    }
}

#[component]
fn MainContent() -> impl IntoView {
    // --- LIFTED STATE ---
    let (api_key, set_api_key, _) =
        use_local_storage::<String, FromToStringCodec>("OPENROUTER_API_KEY");
    let (system_prompts, set_system_prompts, _) =
        use_local_storage::<Vec<SystemPrompt>, JsonSerdeCodec>("system_prompts");
    let (model_name_storage, set_model_name_storage, _) =
        use_local_storage::<String, FromToStringCodec>("MODEL_NAME");
    let (cached_models, set_cached_models, _) =
        use_local_storage::<Vec<DisplayModelInfo>, JsonSerdeCodec>("cached_models");
    let (input, set_input, _) = use_local_storage::<String, FromToStringCodec>("input");
    let (selected_prompt_name, set_selected_prompt_name, _) =
        use_local_storage::<Option<String>, JsonSerdeCodec>("selected_prompt_name");

    // --- Session Navigation State ---
    let sorted_session_ids = RwSignal::new(Vec::<String>::new());
    let current_session_index = RwSignal::new(None::<usize>);

    // --- Current Session State ---
    // Current session state
    let messages = RwSignal::new(Vec::<Message>::new());
    let error = RwSignal::new(None::<String>);
    let current_session_id = RwSignal::new(None::<String>);
    // --- Child-to-Parent Communication ---
    let (session_load_request, set_session_load_request) = signal(None::<String>);
    let navigation_request = RwSignal::new(None::<String>);
    let initial_chat_prompt = RwSignal::new(None::<String>);

    let debounced_save_session = use_debounce_fn(
        move || {
            let session_id_to_save = current_session_id.get();
            let msgs_to_save = messages.get();

            if let Some(session_id_to_save) = session_id_to_save {
                if session_id_to_save.is_empty() || msgs_to_save.is_empty() {
                    return;
                }
                spawn_local(async move {
                    let existing_session = persistence::load_session(&session_id_to_save).await.ok().flatten();
                    let is_new_session = existing_session.is_none();
                    let session_prompt_name = msgs_to_save
                        .first()
                        .filter(|m| m.role == "system")
                        .and_then(|m| m.prompt_name.clone());

                    let session_to_save_db = ChatSession {
                        session_id: session_id_to_save.clone(),
                        messages: msgs_to_save,
                        name: None,
                        created_at_ms: existing_session.map_or_else(Date::now, |s| s.created_at_ms),
                        updated_at_ms: Date::now(),
                        prompt_name: session_prompt_name,
                    };

                    if persistence::save_session(&session_to_save_db).await.is_ok() && is_new_session {
                        sorted_session_ids.update(|ids| {
                            if !ids.iter().any(|id| id == &session_id_to_save) {
                                ids.insert(0, session_id_to_save);
                            }
                        });
                    }
                });
            }
        },
        2000.0,
    );

    let global_state = GlobalState {
        api_key,
        set_api_key,
        system_prompts,
        set_system_prompts,
        model_name: model_name_storage,
        set_model_name: set_model_name_storage,
        input,
        set_input,
        cached_models,
        set_cached_models,
        messages,
        selected_prompt_name,
        set_selected_prompt_name,
        error,
        current_session_id,
        session_load_request: set_session_load_request,
        navigation_request,
        initial_chat_prompt,
        save_session: Callback::new(move |_| { debounced_save_session(); }),
    };
    provide_context(global_state.clone());

    // --- Actions (triggered by effects) ---
    let load_session_list = StoredValue::new(move || {
        spawn_local(async move {
            match persistence::get_all_session_keys_sorted_by_update().await {
                Ok(keys) => {
                    sorted_session_ids.set(keys);
                }
                Err(e) => error.set(Some(format!("Failed to load session list: {e}"))),
            }
        })
    });

    // --- Effects ---
    // Initial load of session list
    Effect::new(move |prev: Option<()>| {
        if prev.is_none() {
            load_session_list.get_value()();
        }
    });

    // When the app loads, check if the stored prompt name is still valid.
    Effect::new(move |_| {
        let all_prompts = system_prompts.get();
        let current_prompt_name = selected_prompt_name.get();

        if let Some(name) = current_prompt_name {
            if !all_prompts.iter().any(|p| p.name == name) {
                leptos::logging::log!(
                    "[DEBUG] [MainContent] Clearing stale selected_prompt_name: {}",
                    name
                );
                set_selected_prompt_name.set(None);
            }
        }
    });

    // Listen for requests from ChatPage to load a session
    Effect::new(move |_| {
        if let Some(id_to_load) = session_load_request.get() {

            leptos::logging::log!(
                "[DEBUG] [MainContent] Session load request received for id: '{}'",
                id_to_load
            );
            // 2.1.1. Handle "new" path explicitly
            if id_to_load == "new" {
                global_state.current_session_id.set(None);
                messages.set(vec![]);
                // When starting a new chat, we preserve the selected system prompt
                error.set(None);
            }
            // 2.1.2. Prevent unnecessary reloads for newly ID'd sessions
            else if global_state.current_session_id.get().as_ref() == Some(&id_to_load) {
                // Session ID matches current in-memory session, no need to reload from DB
                leptos::logging::log!("[DEBUG] [MainContent] Session ID in URL matches current in-memory session. Skipping DB load.");
            }
            // 2.1.3. Load existing sessions from IndexedDB
            else {
                spawn_local(async move {
                    match persistence::load_session(&id_to_load).await {
                        Ok(Some(session)) => {
                            global_state.current_session_id.set(Some(session.session_id.clone()));
                            messages.set(session.messages);
                            global_state.set_selected_prompt_name.set(session.prompt_name);
                            error.set(None);
                        }
                        Ok(None) => {
                            error.set(Some(format!("Session {id_to_load} not found.")));
                            navigation_request.set(Some("/chat/new".to_string()));
                            global_state.current_session_id.set(None);
                        }
                        Err(e) => error.set(Some(format!("Error loading session: {e}"))),
                    }
                });
            }
        }
    });

    // Effect to update current_session_index when sorted_session_ids or current_session_id changes
    Effect::new(move |_| {
        let current_id = global_state.current_session_id.get();
        let sorted_ids = sorted_session_ids.get();
        let new_index = current_id.as_ref().and_then(|id_str| {
            sorted_ids.iter().position(|k| k == id_str)
        });
        current_session_index.set(new_index);
    });

    // Effect to handle navigation requests
    let navigate = use_navigate();
    let navigate_for_effect = navigate.clone();
    Effect::new(move |_| {
        if let Some(path) = navigation_request.get() {
            navigate_for_effect(
                &path,
                NavigateOptions {
                    replace: true,
                    ..Default::default()
                },
            );
            navigation_request.set(None);
        }
    });


    // --- Navigation Logic ---
    let can_go_prev = Memo::new(move |_| match current_session_index.get() {
        Some(idx) => idx + 1 < sorted_session_ids.get().len(),
        None => !sorted_session_ids.get().is_empty(),
    });

    let can_go_next =
        Memo::new(move |_| matches!(current_session_index.get(), Some(idx) if idx > 0));


    let on_prev = {
        let navigate = navigate.clone();
        move |_| {
            leptos::logging::log!("[DEBUG] [MainContent] 'Prev' button clicked.");
            let ids = sorted_session_ids.get();
            if ids.is_empty() {
                leptos::logging::log!("[WARN] [MainContent] 'Prev' clicked with no sessions available.");
                return;
            }
            let current_idx = current_session_index.get();
            let new_index = match current_idx {
                Some(idx) => idx + 1,
                None => 0,
            };
            leptos::logging::log!(
                "[DEBUG] [MainContent] 'Prev' navigation. Current index: {:?}, New index: {}.",
                current_idx,
                new_index
            );

            if let Some(new_id) = ids.get(new_index) {
                leptos::logging::log!(
                    "[DEBUG] [MainContent] Navigating to previous session ID: {}",
                    new_id
                );
                navigate(&format!("/chat/{new_id}"), Default::default());
            } else {
                leptos::logging::log!(
                    "[WARN] [MainContent] 'Prev' navigation failed: New index {} is out of bounds (len={}).",
                    new_index,
                    ids.len()
                );
            }
        }
    };


    let on_next = {
        let navigate = navigate.clone();
        move |_| {
            leptos::logging::log!("[DEBUG] [MainContent] 'Next' button clicked.");
            if let Some(idx) = current_session_index.get() {
                if idx > 0 {
                    let ids = sorted_session_ids.get();
                    let new_index = idx - 1;
                    if let Some(new_id) = ids.get(new_index) {
                        leptos::logging::log!(
                            "[DEBUG] [MainContent] 'Next' navigation. Current index: {}, New index: {}. Navigating to ID: {}",
                            idx, new_index, new_id
                        );
                        navigate(&format!("/chat/{new_id}"), Default::default());
                    } else {
                         leptos::logging::log!(
                            "[WARN] [MainContent] 'Next' navigation failed: New index {} is out of bounds for sorted_session_ids (len={}).",
                            new_index, ids.len()
                        );
                    }
                }
            } else {
                leptos::logging::log!("[WARN] [MainContent] 'Next' clicked but no current session index.");
            }
        }
    };

    view! {
        <Header />
        <Routes fallback=|| view! { <h1>"Not Found"</h1> }>
            <Route
                path=path!("/chat/:id")
                view=move || {
                    view! {
                        <ChatPage
                            on_prev=on_prev.clone()
                            on_next=on_next.clone()
                            can_go_prev=can_go_prev
                            can_go_next=can_go_next
                        />
                    }
                }
            />
            <Route
                path=path!("/settings")
                view=move || {
                    let state = use_context::<GlobalState>().expect("GlobalState not found");
                    view! {
                        <Settings
                            api_key=state.api_key
                            set_api_key=state.set_api_key
                            system_prompts=state.system_prompts
                            set_system_prompts=state.set_system_prompts
                        />
                    }
                }
            />
            <Route path=path!("/") view=|| view! { <Redirect path="/chat/new" /> } />
            <Route path=path!("/chat") view=|| view! { <Redirect path="/chat/new" /> } />
        </Routes>
    }
}
