## Message Editing and Regeneration Behavior

- When a user edits a message and re-submits it, send context before the edited message + new user message (discard old assistant response). the conversation is forked at that point.
- When regenerating an assistant message, send only context up to (but not including) the assistant message being regenerated

## Snippets

- the chat requests have stream=true, while the snippets use stream=false.
- it must be possible to wait on individual snippet generations, as well as for the whole generation process to finish
- when a snippet is referenced in a chat message and submittet, we must first wait for referenced snippets to finish generating
- snippets are marked as isDirty in indexeddb, so that generations resume on browser reload
- snippets are identified by id (primary key), but referenced by their unique name.
- when waiting for individual snippets to finish, we'll identify them by id
- an unresolved snippet should propagate an error.
- tests should not use page.goto to navigate between pages (that would trigger reseeding the database state). page.goto is only allowed on initial page load. use clicks instead.
