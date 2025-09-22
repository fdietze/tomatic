import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";
import configureStore from "redux-mock-store";
import SettingsPage from "./SettingsPage";
import {
  setApiKey,
  saveSettings,
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
});
