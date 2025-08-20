use serde::{Deserialize, Serialize};
use crate::chat::types::Message;

// --- IndexedDB Constants ---
pub const DB_NAME: &str = "tomatic_chat_db";
pub const DB_VERSION: u32 = 1;
pub const SESSIONS_STORE_NAME: &str = "chat_sessions";
pub const SESSION_ID_KEY_PATH: &str = "session_id"; // Key path for the object store
pub const UPDATED_AT_INDEX: &str = "updated_at_ms"; // Name for the index on updated_at_ms

// --- Chat Session Data Structure ---
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatSession {
    #[serde(rename = "session_id")] // Ensure JS side (IndexedDB) sees this as session_id
    pub session_id: String,
    pub messages: Vec<Message>,
    pub name: Option<String>, // User-defined name for the session
    pub created_at_ms: f64,
    pub updated_at_ms: f64,
}

use anyhow::{anyhow, Result};
use idb::{Database, event::VersionChangeEvent, Error as IdbError, Factory, IndexParams, KeyPath, ObjectStoreParams, TransactionMode, DatabaseEvent, Event, Request, CursorDirection};
use wasm_bindgen::JsValue;

// --- Database Interaction Functions ---

/// Opens the IndexedDB database and creates/upgrades the object store and indexes.
pub async fn get_db() -> Result<Database, IdbError> {
    let factory = Factory::new()?;

    let mut open_request = factory.open(DB_NAME, Some(DB_VERSION))?;

    open_request.on_upgrade_needed(|event: VersionChangeEvent| {
        let db = match event.database() {
            Ok(db) => db,
            Err(e) => {
                leptos::logging::log!("[ERROR] [DB] Failed to get database in on_upgrade_needed: {:?}", e);
                return; // Cannot proceed with upgrade.
            }
        };

        // Create object store if it doesn't exist
        if !db.store_names().iter().any(|name| *name == SESSIONS_STORE_NAME) {
            leptos::logging::log!("[INFO] [DB] Creating object store: {}", SESSIONS_STORE_NAME);
            let mut store_params = ObjectStoreParams::new();
            store_params.key_path(Some(KeyPath::new_single(SESSION_ID_KEY_PATH)));
            match db.create_object_store(SESSIONS_STORE_NAME, store_params) {
                Ok(store) => {
                    // Create index on the new store
                    leptos::logging::log!("[INFO] [DB] Creating index '{}' on store '{}'", UPDATED_AT_INDEX, SESSIONS_STORE_NAME);
                    let mut index_params = IndexParams::new();
                    index_params.unique(false); // updated_at_ms might not be unique
                    if let Err(e) = store.create_index(UPDATED_AT_INDEX, KeyPath::new_single("updated_at_ms"), Some(index_params)) {
                        leptos::logging::log!("[ERROR] [DB] Failed to create index '{}' on store '{}': {:?}", UPDATED_AT_INDEX, SESSIONS_STORE_NAME, e);
                    }
                }
                Err(e) => {
                    leptos::logging::log!("[ERROR] [DB] Failed to create object store '{}': {:?}", SESSIONS_STORE_NAME, e);
                    // If store creation fails, we can't create indexes on it.
                }
            }
        } else {
            // Store exists, check if index needs to be created (e.g., upgrading from a version without it)
            // This requires getting the transaction from the upgrade event.
            match event.target() {
                Ok(open_db_request) => { // open_db_request is idb::request::OpenDbRequest
                    if let Some(transaction) = open_db_request.transaction() { // transaction is idb::Transaction
                        match transaction.object_store(SESSIONS_STORE_NAME) {
                            Ok(store) => {
                                if !store.index_names().iter().any(|name| name == UPDATED_AT_INDEX) {
                                    leptos::logging::log!("[INFO] [DB] Store '{}' exists, creating missing index: {}", SESSIONS_STORE_NAME, UPDATED_AT_INDEX);
                                    let mut index_params = IndexParams::new();
                                    index_params.unique(false);
                                    if let Err(e) = store.create_index(UPDATED_AT_INDEX, KeyPath::new_single("updated_at_ms"), Some(index_params)) {
                                        leptos::logging::log!("[ERROR] [DB] Failed to create index '{}' on existing store '{}': {:?}", UPDATED_AT_INDEX, SESSIONS_STORE_NAME, e);
                                    }
                                }
                            }
                            Err(e) => {
                                leptos::logging::log!("[ERROR] [DB] Failed to get object store '{}' from upgrade transaction: {:?}", SESSIONS_STORE_NAME, e);
                            }
                        }
                    } else {
                        leptos::logging::log!("[WARN] [DB] Upgrade transaction was None from OpenDbRequest.");
                    }
                }
                Err(e) => {
                    leptos::logging::log!("[ERROR] [DB] Failed to get OpenDbRequest event target during upgrade: {:?}", e);
                }
            }
        }
        // The upgrade transaction commits automatically when `on_upgrade_needed` handler finishes.
    });

    open_request.await
}

/// Saves (adds or updates) a chat session in IndexedDB.
pub async fn save_session(session: &ChatSession) -> Result<()> {
    let db = get_db().await.map_err(|e| anyhow!("[DB] Save: DB open error: {}", e.to_string()))?;
    let tx = db
        .transaction(&[SESSIONS_STORE_NAME], TransactionMode::ReadWrite)
        .map_err(|e| anyhow!("[DB] Save: Failed to start transaction: {}", e.to_string()))?;
    let store = tx
        .object_store(SESSIONS_STORE_NAME)
        .map_err(|e| anyhow!("[DB] Save: Failed to get object store: {}", e.to_string()))?;

    let js_value = serde_wasm_bindgen::to_value(session)
        .map_err(|e| anyhow!("[DB] Save: Failed to serialize session: {}", e.to_string()))?;

    // `put` will add or update based on the keyPath.
    // Key is derived from `session_id` field in js_value due to store's keyPath.
    store
        .put(&js_value, None)
        .map_err(|e| anyhow!("[DB] Save: Failed to put session (sync): {}", e.to_string()))?
        .await // Wait for the put operation itself to complete
        .map_err(|e| anyhow!("[DB] Save: Failed to put session (async): {}", e.to_string()))?;

    tx.commit() // Commit the transaction
        .map_err(|e| anyhow!("[DB] Save: Failed to initiate commit (sync): {}", e.to_string()))?
        .await // Wait for commit to complete
        .map_err(|e| anyhow!("[DB] Save: Transaction commit error: {}", e.to_string()))?;

    leptos::logging::log!("[DEBUG] [DB] Session saved successfully: {}", session.session_id);
    Ok(())
}

/// Loads a chat session from IndexedDB by its ID.
pub async fn load_session(session_id: &str) -> Result<Option<ChatSession>> {
    let db = get_db().await.map_err(|e| anyhow!("[DB] Load: DB open error: {}", e.to_string()))?;
    let tx = db
        .transaction(&[SESSIONS_STORE_NAME], TransactionMode::ReadOnly)
        .map_err(|e| anyhow!("[DB] Load: Failed to start transaction: {}", e.to_string()))?;
    let store = tx
        .object_store(SESSIONS_STORE_NAME)
        .map_err(|e| anyhow!("[DB] Load: Failed to get object store: {}", e.to_string()))?;

    let key_js_value = JsValue::from_str(session_id);
    let js_value_opt: Option<JsValue> = store
        .get(idb::Query::from(key_js_value)) // Query::from takes ownership, or use Query::key()
        .map_err(|e| anyhow!("[DB] Load: Failed to initiate get op for id '{}' (sync): {}", session_id, e.to_string()))?
        .await
        .map_err(|e| anyhow!("[DB] Load: Failed to get JsValue for id '{}' (async): {}", session_id, e.to_string()))?;

    let session_opt: Option<ChatSession> = match js_value_opt {
        Some(js_value) => {
            Some(serde_wasm_bindgen::from_value(js_value)
                .map_err(|e| anyhow!("[DB] Load: Failed to deserialize session id '{}': {}", session_id, e.to_string()))?)
        }
        None => None,
    };

    tx.await // Wait for read-only transaction to complete
        .map_err(|e| anyhow!("[DB] Load: Transaction completion error: {}", e.to_string()))?;

    if session_opt.is_some() {
        leptos::logging::log!("[DEBUG] [DB] Session loaded successfully: {}", session_id);
    } else {
        leptos::logging::log!("[DEBUG] [DB] Session not found: {}", session_id);
    }
    Ok(session_opt)
}

/// Loads all session keys (IDs) from IndexedDB, sorted by `updated_at_ms` in descending order (newest first).
pub async fn get_all_session_keys_sorted_by_update() -> Result<Vec<String>> {
    let db = get_db().await.map_err(|e| anyhow!("[DB] ListKeys: DB open error: {}", e.to_string()))?;
    let tx = db
        .transaction(&[SESSIONS_STORE_NAME], TransactionMode::ReadOnly)
        .map_err(|e| anyhow!("[DB] ListKeys: Failed to start transaction: {}", e.to_string()))?;
    let store = tx
        .object_store(SESSIONS_STORE_NAME)
        .map_err(|e| anyhow!("[DB] ListKeys: Failed to get object store: {}", e.to_string()))?;
    let index = store
        .index(UPDATED_AT_INDEX)
        .map_err(|e| anyhow!("[DB] ListKeys: Failed to get index: {}", e.to_string()))?;

    let mut cursor = index
        .open_cursor(None, Some(CursorDirection::Prev))
        .map_err(|e| anyhow!("[DB] ListKeys: Failed to open cursor (sync): {}", e.to_string()))?
        .await
        .map_err(|e| anyhow!("[DB] ListKeys: Failed to open cursor (async): {}", e.to_string()))?;

    let mut keys = Vec::new();
    while let Some(c) = cursor {
        match c.primary_key() {
            Ok(primary_key_js) => {
                if let Some(key_str) = primary_key_js.as_string() {
                    keys.push(key_str);
                } else {
                    leptos::logging::log!("[WARN] [DB] ListKeys: Cursor found a record with a non-string or null primary key.");
                }
            }
            Err(e) => leptos::logging::log!("[WARN] [DB] ListKeys: Error getting primary key from cursor: {:?}", e),
        }
        cursor = c.next(None)
            .map_err(|e| anyhow!("[DB] ListKeys: Failed to initiate next (sync): {}", e.to_string()))?
            .await
            .map_err(|e| anyhow!("[DB] ListKeys: Error advancing cursor (async): {}", e.to_string()))?;
    }

    tx.await
        .map_err(|e| anyhow!("[DB] ListKeys: Transaction completion error: {}", e.to_string()))?;

    leptos::logging::log!("[DEBUG] [DB] Fetched {} session keys sorted by update time.", keys.len());
    Ok(keys)
}


/// Deletes a chat session from IndexedDB by its ID. (For future use)
#[allow(dead_code)]
pub async fn delete_session(session_id: &str) -> Result<()> {
    let db = get_db().await.map_err(|e| anyhow!("[DB] Delete: DB open error: {}", e.to_string()))?;
    let tx = db
        .transaction(&[SESSIONS_STORE_NAME], TransactionMode::ReadWrite)
        .map_err(|e| anyhow!("[DB] Delete: Failed to start transaction: {}", e.to_string()))?;
    let store = tx
        .object_store(SESSIONS_STORE_NAME)
        .map_err(|e| anyhow!("[DB] Delete: Failed to get object store: {}", e.to_string()))?;

    let key_js_value = JsValue::from_str(session_id);
    store
        .delete(idb::Query::from(key_js_value))
        .map_err(|e| anyhow!("[DB] Delete: Failed to initiate delete for id '{}' (sync): {}", session_id, e.to_string()))?
        .await
        .map_err(|e| anyhow!("[DB] Delete: Failed to complete delete for id '{}' (async): {}", session_id, e.to_string()))?;

    tx.commit()
        .map_err(|e| anyhow!("[DB] Delete: Failed to initiate commit (sync): {}", e.to_string()))?
        .await
        .map_err(|e| anyhow!("[DB] Delete: Transaction commit error: {}", e.to_string()))?;
    
    leptos::logging::log!("[DEBUG] [DB] Session deleted successfully: {}", session_id);
    Ok(())
}
