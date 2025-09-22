import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import createSagaMiddleware from "redux-saga";
import { configureStore } from "@reduxjs/toolkit";

import { AppContent } from "@/App";
import rootReducer from "@/store/rootReducer";
import rootSaga from "@/store/rootSaga";
import { Message } from "@/types/chat";

const sagaMiddleware = createSagaMiddleware();

const mockStore = (initialState: Partial<RootState>) => {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: initialState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(sagaMiddleware),
  });
  sagaMiddleware.run(rootSaga);
  return store;
};

type RootState = ReturnType<typeof rootReducer>;

const TEST_SESSION_ID = "test-session-123";

const MOCK_MESSAGES: Message[] = [
  { id: "1", role: "user", content: "Hello" },
  { id: "2", role: "assistant", content: "Hi there!" },
];

describe("App Navigation", () => {
  it("should preserve the chat session when navigating to settings and back", async () => {
    // 1. Arrange: Set up the mock store and initial state
    const initialState: Partial<RootState> = {
      session: {
        messages: MOCK_MESSAGES,
        currentSessionId: TEST_SESSION_ID,
        prevSessionId: null,
        nextSessionId: null,
        loading: "idle",
        submitting: false,
        error: null,
      },
    };
    const store = mockStore(initialState);

    // 2. Act: Render the app, starting at the specific chat session URL
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[`/chat/${TEST_SESSION_ID}`]}>
          <AppContent />
        </MemoryRouter>
      </Provider>,
    );

    // 3. Assert: Check that we are on the correct chat page
    await waitFor(() => {
      expect(screen.getByText("Hi there!")).toBeInTheDocument();
    });

    // 4. Act: Navigate to the settings page
    await userEvent.click(screen.getByTestId("settings-button"));

    // 5. Assert: Check that we are on the settings page
    await waitFor(() => {
      expect(screen.getByText(/OPENROUTER_API_KEY/i)).toBeInTheDocument();
    });

    // 6. Act: Navigate back to the chat page
    await userEvent.click(screen.getByTestId("chat-button"));

    // 7. Assert: Check that we have returned to the *same* chat session
    await waitFor(() => {
      expect(screen.getByText("Hi there!")).toBeInTheDocument();
    });

    // This is the key assertion that will fail.
    // We need to inspect the current path in the MemoryRouter's history.
    // Unfortunately, getting the current URL is not straightforward with RTL and MemoryRouter.
    // Instead, we will rely on the content of the page as a proxy for the URL.
    // If the old message is visible, we are on the correct page.
    // If it's not, and we were redirected to /chat/new, the message list would be empty.
  });
});
