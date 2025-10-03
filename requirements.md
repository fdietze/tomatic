## Message Editing and Regeneration Behavior

- req:message-edit-fork: When a user edits a message and re-submits it, send context before the edited message + new user message (discard old assistant response). the conversation is forked at that point.
- req:regenerate-context: When regenerating an assistant message, send only context up to (but not including) the assistant message being regenerated

## Snippets

- req:chat-stream-true: the chat requests have stream=true, while the snippets use stream=false.
- req:snippet-wait-individual: it must be possible to wait on individual snippet generations, as well as for the whole generation process to finish
- req:snippet-wait-before-submit: when a snippet is referenced in a chat message and submittet, we must first wait for referenced snippets to finish generating
- req:snippet-dirty-indexeddb: snippets are marked as isDirty in indexeddb, so that generations resume on browser reload
- req:snippet-id-vs-name: snippets are identified by id (primary key), but referenced by their unique name.
- req:snippet-wait-by-id: when waiting for individual snippets to finish, we'll identify them by id
- req:snippet-error-propagation: an unresolved snippet should propagate an error.
- req:test-no-page-goto: tests should not use page.goto to navigate between pages (that would trigger reseeding the database state). page.goto is only allowed on initial page load. use clicks instead.
- req:dirty-loading-indicator: all snippets marked as dirty should show a loading indicator
- req:error-warning-sign: all snippets with an error of any kind (cycle, invalid snippet references, failed generation etc) should show a warning sign.
- req:global-loading-spinner: whenever there are dirty snippets being regenerated, that should be reflected in a global loading spinner in the settings tab
- req:snippet-loading-buttons-visible: When a snippet is regenerating, the loading indicator is displayed next to the action buttons, which remain visible and clickable.
- req:snippet-edit-cancels-generation: Starting to edit a regenerating snippet cancels the ongoing generation.

## Chat Session Management

- req:auto-save-new-chat: when a user sends their first message on /chat/new, the session is automatically saved to the database and the URL changes to reflect the persistent session ID
- req:system-prompt-preservation: system prompts are preserved when auto-saving new chat sessions
- req:session-navigation: users can navigate between previous/next sessions with proper button states at boundaries
- req:url-navigation-behavior: /chat/new shows an empty session, existing sessions are accessible via /chat/{sessionId} URLs

## Model Selection

- req:model-selection: users can select different AI models and subsequent messages are processed by the newly selected model
- req:model-display: assistant messages display which model was used to generate the response

## Database Migrations

- req:database-migrations: support for migrating IndexedDB schema from v1→v2→v3 while preserving data integrity
- req:migration-events: database migrations dispatch completion events for coordination
- req:localStorage-migrations: support for migrating localStorage from v0→v1 with automatic version detection and data transformation
- req:migration-test-fixtures: JSON fixtures exist for all migration versions (localStorage v0-v1, IndexedDB v1-v3) for comprehensive testing
- req:migration-unit-tests: unit tests verify all migration paths work correctly and handle edge cases gracefully
- req:migration-consolidation: unified migration system in src/services/persistence/migrations.ts serves as single source of truth for all storage layer migrations
- req:migration-error-handling: when migrations fail, the user must see an error message

## Input Validation

- req:name-validation: snippet and system prompt names must contain only alphanumeric characters and underscores
- req:name-uniqueness: snippet and system prompt names must be unique (case-insensitive)
- req:name-required: snippet and system prompt names cannot be empty

## Snippet Dependency Management

- req:dependency-validation: real-time validation of snippet dependencies with immediate UI feedback
- req:cycle-detection: detection and prevention of circular dependencies in snippet references
- req:transitive-regeneration: cascading regeneration of dependent snippets in correct topological order
- req:dependency-error-propagation: failed regeneration propagates errors to all dependent snippets
- req:empty-prompt-handling: generated snippets with empty resolved prompts skip API calls and clear content

## UI Behavior

- req:generated-snippet-ui: UI toggles between standard snippet fields (content input) and generated snippet fields (prompt, model, read-only content)
- req:raw-content-preservation: user messages preserve original raw input with snippet references for editing
- req:edit-textarea-population: when editing messages, textarea is populated with raw content rather than resolved content
- req:save-button-dirty-detection: pressing the save button on a generated snippet should mark it as dirty if the prompt input is different from the original
- req:snippet-expand-collapse: snippet content can be expanded/collapsed instead of fullscreen viewing. Collapsed shows plain text, expanded shows markdown rendering
- req:system-prompt-navigation-sync: when navigating through chat history using prev/next buttons, the selected system prompt should automatically update to match the system prompt stored in the system message of the loaded chat history. If the session has no system message, no prompt should be selected, always reflecting what is persisted with the current session.
- req:system-prompt-interactive-update: when a chat session is loaded (with or without system prompt) and the user selects a different system prompt, the system message must reflect what was selected (no selection -> no system message). This modified chat history is only persisted when an actual submission/regeneration happens.
- when migrations fail, the user must see an error message.
