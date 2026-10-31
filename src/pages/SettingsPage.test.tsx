import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";
import configureStore from "redux-mock-store";
import SettingsPage from "./SettingsPage";
import {
  setApiKey,
  saveSettings,
  toggleChatSnippetResolution,
} from "@/store/features/settings/settingsSlice";
import { MockStoreEnhanced } from "redux-mock-store";

// Mock the Redux store
const mockStore = configureStore([]);

describe("SettingsPage", () => {
  let store: MockStoreEnhanced<unknown, unknown>;

  beforeEach(() => {
    store = mockStore({
      settings: {
        apiKey: "",
        autoScrollEnabled: false,
        chatSnippetResolutionEnabled: false,
        saving: "idle",
      },
      prompts: {
        prompts: {},
      },
      snippets: {
        snippets: [],
        loading: "idle",
      },
    });

    store.dispatch = vi.fn();
  });

  test("should dispatch setApiKey and saveSettings when save button is clicked", () => {
    // Purpose: This test verifies that clicking the 'Save' button for the API key
    // dispatches the correct actions to update the key and persist the settings.

    render(
      <Provider store={store}>
        <SettingsPage />
      </Provider>,
    );

    // 1. Find the input and the save button
    const apiKeyInput = screen.getByPlaceholderText("OPENROUTER_API_KEY");
    const saveButton = screen.getByRole("button", { name: /save/i });

    // 2. Simulate user typing an API key
    fireEvent.change(apiKeyInput, { target: { value: "test-api-key" } });

    // 3. Simulate user clicking the save button
    fireEvent.click(saveButton);

    // 4. Assert that the correct actions were dispatched
    expect(store.dispatch).toHaveBeenCalledWith(setApiKey("test-api-key"));
    expect(store.dispatch).toHaveBeenCalledWith(saveSettings({}));
  });

  test("should toggle and persist chat snippet resolution via its checkbox", () => {
    // Purpose: req:chat-snippet-resolution-setting - the checkbox shows the (default off) state and toggles + saves the setting.
    render(
      <Provider store={store}>
        <SettingsPage />
      </Provider>,
    );

    const checkbox = screen.getByTestId("chat-snippet-resolution-checkbox");
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    expect(store.dispatch).toHaveBeenCalledWith(toggleChatSnippetResolution());
    expect(store.dispatch).toHaveBeenCalledWith(saveSettings({}));
  });

  test("shows the snippet storage error", () => {
    // Purpose: req:snippet-storage-errors-visible - snippet persistence failures are rendered in the snippets section.
    const storeWithError = mockStore({
      settings: { apiKey: "", autoScrollEnabled: false, chatSnippetResolutionEnabled: false, saving: "idle" },
      prompts: { prompts: {} },
      snippets: {
        snippets: [],
        loading: "idle",
        error: { type: "PERSISTENCE_ERROR", operation: "deleteSnippet", message: "disk full" },
      },
    });

    render(
      <Provider store={storeWithError}>
        <SettingsPage />
      </Provider>,
    );

    expect(screen.getByTestId("snippets-error")).toHaveTextContent("disk full");
  });

  test("shows the system prompt storage error", () => {
    // Purpose: req:snippet-storage-errors-visible - system prompt load/save failures are rendered in the prompts section.
    const storeWithError = mockStore({
      settings: { apiKey: "", autoScrollEnabled: false, chatSnippetResolutionEnabled: false, saving: "idle" },
      prompts: {
        prompts: {},
        error: { type: "PERSISTENCE_ERROR", operation: "loadPrompts", message: "Stored system prompts are invalid" },
      },
      snippets: { snippets: [], loading: "idle" },
    });

    render(
      <Provider store={storeWithError}>
        <SettingsPage />
      </Provider>,
    );

    expect(screen.getByTestId("prompts-error")).toHaveTextContent("Stored system prompts are invalid");
  });
});
