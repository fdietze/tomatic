# Session Management Testing Scenarios

This document outlines manual testing scenarios for the chat session management feature, specifically focusing on the dynamic URL updates and persistence.

## 3.1. Manual Testing Scenarios

### 3.1.1. New Chat - First Message

**Steps:**
1.  Open the application and navigate to `/chat/new` (or click "New Chat" if already on another session).
2.  Type a message into the input field.
3.  Submit the message (e.g., by pressing Enter or clicking "Go").

**Expected Outcome:**
*   The URL in the browser's address bar should immediately change from `/chat/new` to `/chat/<uuid>`, where `<uuid>` is a newly generated unique identifier.
*   The submitted message should appear in the chat history.
*   An assistant response (if applicable) should follow.

### 3.1.2. Refresh Newly ID'd Chat

**Steps:**
1.  Complete scenario 3.1.1, so you are on a chat session with a UUID in the URL (e.g., `/chat/some-uuid`).
2.  Refresh the browser page (e.g., by pressing F5 or clicking the refresh button).

**Expected Outcome:**
*   The chat session, including all previous messages, should be loaded correctly from persistence.
*   The URL should remain `/chat/<uuid>`.
*   The chat interface should display the full conversation history.

### 3.1.3. Start Another New Chat

**Steps:**
1.  From any existing chat session (either `/chat/new` or `/chat/<uuid>`), click the "New Chat" button in the header.

**Expected Outcome:**
*   The URL should change to `/chat/new`.
*   The chat interface should be empty, ready for a new conversation.
*   No previous messages should be displayed.

### 3.1.4. Navigate Between Sessions

**Steps:**
1.  Create at least two distinct chat sessions by repeating scenario 3.1.1 multiple times (e.g., submit a message in `/chat/new`, then click "New Chat" and submit another message). This will create two sessions with different UUIDs.
2.  Use the "Prev" and "Next" navigation buttons in the header to switch between the created sessions.
3.  Alternatively, manually change the URL in the browser to an existing session's UUID (e.g., `/chat/first-uuid`, then `/chat/second-uuid`).

**Expected Outcome:**
*   When navigating, the URL should update to reflect the session ID of the selected chat.
*   The chat interface should display the correct conversation history for the loaded session.
*   The "Prev" and "Next" buttons should enable/disable appropriately based on the available session history.

### 3.1.5. Empty Chat Not Saved

**Steps:**
1.  Navigate to `/chat/new`.
2.  Do NOT type or submit any message.
3.  Navigate away from the page (e.g., go to `/settings` or close the tab).
4.  Re-open the application or navigate back to the main chat interface.

**Expected Outcome:**
*   No new, empty session should appear in the list of available sessions (e.g., the "Prev"/"Next" buttons should not show an additional empty chat).
*   The application should not have persisted an empty chat session to IndexedDB.

### 3.1.6. Direct URL to Non-Existent Session

**Steps:**
1.  Manually type a non-existent or invalid UUID into the browser's address bar (e.g., `/chat/this-is-not-a-real-id`).

**Expected Outcome:**
*   An error message should be displayed to the user (e.g., "Session <id> not found.").
*   The application should ideally redirect to `/chat/new` or a similar default state, allowing the user to start a new conversation.
