mod chat;
mod combobox;
mod copy_button;
mod dom_utils;
mod llm;
mod persistence;
mod settings;

use crate::chat::{ChatInterface, Message, SystemPrompt, SystemPromptBar};
use crate::llm::DisplayModelInfo;
use crate::persistence::ChatSession;
use crate::settings::Settings;
use codee::string::{FromToStringCodec, JsonSerdeCodec};
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::components::{Redirect, Route, Router, Routes};
use leptos_router::hooks::{use_navigate, use_params_map};
use leptos_router::{path, NavigateOptions};
use leptos_use::storage::use_local_storage;
use leptos_use::use_debounce_fn_with_arg;

use web_sys::js_sys::Date;

#[derive(Clone)]
pub struct GlobalState {
    // App-wide state
    api_key: Signal<String>,
    set_api_key: WriteSignal<String>,
    system_prompts: Signal<Vec<SystemPrompt>>,
    set_system_prompts: WriteSignal<Vec<SystemPrompt>>,
    model_name: Signal<String>,
    set_model_name: WriteSignal<String>,
    input: Signal<String>,
    set_input: WriteSignal<String>,
    cached_models: Signal<Vec<DisplayModelInfo>>,
    set_cached_models: WriteSignal<Vec<DisplayModelInfo>>,
    // Current session state
    pub messages: RwSignal<Vec<Message>>,
    pub selected_prompt_name: RwSignal<Option<String>>,
    pub error: RwSignal<Option<String>>,
    pub current_session_id: RwSignal<Option<String>>,
    // Request from child to parent
    pub session_load_request: WriteSignal<Option<String>>,
    pub navigation_request: RwSignal<Option<String>>,
}

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

    // --- Session Navigation State ---
    let sorted_session_ids = RwSignal::new(Vec::<String>::new());
    let current_session_index = RwSignal::new(None::<usize>);

    // --- Current Session State ---
    // Current session state
    let messages = RwSignal::new(Vec::<Message>::new());
    let selected_prompt_name = RwSignal::new(None::<String>);
    let error = RwSignal::new(None::<String>);

    // --- Child-to-Parent Communication ---
    let (session_load_request, set_session_load_request) = signal(None::<String>);
    let navigation_request = RwSignal::new(None::<String>);

    // --- Provide Context ---
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
        error,
        current_session_id: RwSignal::new(None::<String>),
        session_load_request: set_session_load_request,
        navigation_request,
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

    // Listen for requests from ChatPage to load a session
    Effect::new(move |_| {
        if let Some(id_to_load) = session_load_request.get() {
            // 2.1.1. Handle "new" path explicitly
            if id_to_load == "new" {
                global_state.current_session_id.set(None);
                messages.set(vec![]);
                selected_prompt_name.set(None);
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
                            global_state.current_session_id.set(Some(session.session_id));
                            messages.set(session.messages);
                            selected_prompt_name.set(None);
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

    // Debounced save session
    let debounced_save_session = use_debounce_fn_with_arg(
        move |(session_id_to_save, msgs_to_save): (String, Vec<Message>)| {
            if session_id_to_save.is_empty() || msgs_to_save.is_empty() {
                return;
            }
            spawn_local(async move {
                let created_at = persistence::load_session(&session_id_to_save)
                    .await
                    .ok()
                    .flatten()
                    .map(|s| s.created_at_ms)
                    .unwrap_or_else(Date::now);
                let session_to_save_db = ChatSession {
                    session_id: session_id_to_save.clone(),
                    messages: msgs_to_save,
                    name: None,
                    created_at_ms: created_at,
                    updated_at_ms: Date::now(),
                };
                if persistence::save_session(&session_to_save_db)
                    .await
                    .is_ok()
                {
                    load_session_list.get_value()();
                }
            });
        },
        2000.0,
    );

    // Effect to trigger debounced save
    Effect::new(move |_| {
        let id = global_state.current_session_id.get();
        let msgs = messages.get();
        // 2.2. Adjust `debounced_save_session` Trigger:
        // Only save if a session ID has been assigned and there are messages.
        if let Some(id_val) = id {
            if !msgs.is_empty() {
                debounced_save_session((id_val, msgs));
            }
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
            let ids = sorted_session_ids.get();
            if ids.is_empty() {
                return;
            }
            let new_index = match current_session_index.get() {
                Some(idx) => idx + 1,
                None => 0,
            };
            if new_index < ids.len() {
                navigate(&format!("/chat/{}", ids[new_index]), Default::default());
            }
        }
    };

    let on_next = {
        let navigate = navigate.clone();
        move |_| {
            if let Some(idx) = current_session_index.get() {
                if idx > 0 {
                    let ids = sorted_session_ids.get();
                    let new_index = idx - 1;
                    navigate(&format!("/chat/{}", ids[new_index]), Default::default());
                }
            }
        }
    };

    let on_new_chat = {
        let navigate = navigate.clone();
        move |_| {
            navigate("/chat/new", Default::default());
        }
    };


    let on_chat = {
        let navigate = navigate.clone();
        let global_state = global_state.clone();
        move |_| {
            if let Some(id) = global_state.current_session_id.get() {
                navigate(&format!("/chat/{id}"), Default::default());
            } else {
                navigate("/chat/new", Default::default());
            }
        }
    };

    let on_settings = {
        let navigate = navigate.clone();
        move |_| {
            navigate("/settings", Default::default());
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
            <button data-role="primary" data-size="compact" on:click=on_new_chat>
                "New Chat"
            </button>
            <button data-size="compact" on:click=on_chat style:margin-left="4px">
                "Chat"
            </button>
            <button data-size="compact" on:click=on_settings>
                "Settings"
            </button>
        </header>
        <Routes fallback=|| view! { <h1>"Not Found"</h1> }>
            <Route path=path!("/chat/:id") view=ChatPage />
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

#[component]
fn ChatPage() -> impl IntoView {
    let params = use_params_map();
    let state = use_context::<GlobalState>().expect("GlobalState context not found");

    // When the :id parameter in the URL changes, send a request to the parent App to load the session
    Effect::new(move |_| {
        let id = params.with(|p| p.get("id").map(|s| s.to_owned()).unwrap_or_default());
        state.session_load_request.set(Some(id));
    });

    view! {
        <ChatInterface
            messages=state.messages.read_only()
            set_messages=state.messages.write_only()
            system_prompts=state.system_prompts
            selected_prompt_name=state.selected_prompt_name.read_only()
            set_selected_prompt_name=state.selected_prompt_name.write_only()
            error=state.error.read_only()
            set_error=state.error.write_only()
            api_key=state.api_key
            model_name=state.model_name
            set_model_name=state.set_model_name
            input=state.input
            set_input=state.set_input
            cached_models=state.cached_models
            set_cached_models=state.set_cached_models
        />
    }
}

