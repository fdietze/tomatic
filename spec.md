# Tomatic Porting Specification

This document outlines the data structures and URL schemes that the new TypeScript/React application must adhere to for compatibility with the existing Rust application's data stored in the user's browser.

## URL Schemes

The application uses `leptos_router` for client-side routing. The new application should support the following routes:

- `/`: Redirects to `/chat/new`.
- `/chat`: Redirects to `/chat/new`.
- `/chat/new`: Opens a new, empty chat session.
  - It can accept an optional query parameter `q` to start a new chat with a pre-filled prompt. Example: `/chat/new?q=Hello%20world`.
- `/chat/:id`: Loads a specific chat session from IndexedDB using the provided `id`.
- `/settings`: Displays the application settings page.

## Local Storage

The application uses `leptos_use::use_local_storage` to persist several pieces of state. The keys and their corresponding data structures are:

| Key                      | Type                                           | Encoding | Description                               |
| ------------------------ | ---------------------------------------------- | -------- | ----------------------------------------- |
| `OPENROUTER_API_KEY`     | `String`                                       | Raw      | The user's OpenRouter API key.            |
| `system_prompts`         | `Vec<SystemPrompt>`                            | JSON     | A list of user-defined system prompts.    |
| `MODEL_NAME`             | `String`                                       | Raw      | The ID of the currently selected model.   |
| `cached_models`          | `Vec<DisplayModelInfo>`                        | JSON     | A cached list of available models from OR. |
| `input`                  | `String`                                       | Raw      | The current content of the chat textarea. |
| `selected_prompt_name`   | `Option<String>`                               | JSON     | The name of the selected system prompt.   |

### Data Structures (JSON)

**`SystemPrompt`**
```json
{
  "name": "string",
  "prompt": "string"
}
```

**`DisplayModelInfo`**
```json
{
  "id": "string",
  "name": "string",
  "prompt_cost_usd_pm": "number | null",
  "completion_cost_usd_pm": "number | null"
}
```

## IndexedDB

Chat sessions are stored in IndexedDB.

- **Database Name**: `tomatic_chat_db`
- **Database Version**: `1`
- **Object Store**: `chat_sessions`
- **Key Path**: `session_id`
- **Indexes**:
  - `updated_at_ms`: on the `updated_at_ms` field, used for sorting sessions.

### Data Structure: `ChatSession`

This is the structure of objects stored in the `chat_sessions` object store.

```json
{
  "session_id": "string",
  "messages": "Message[]",
  "name": "string | null",
  "created_at_ms": "number",
  "updated_at_ms": "number",
  "prompt_name": "string | null"
}
```

**`Message`**
```json
{
  "prompt_name": "string | null",
  "role": "string", // "user", "assistant", or "system"
  "content": "string",
  "model_name": "string | null",
  "cost": "MessageCost | null"
}
```

**`MessageCost`**
```json
{
  "prompt": "number",
  "completion": "number"
}
```
