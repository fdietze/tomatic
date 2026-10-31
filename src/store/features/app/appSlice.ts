import { createSlice } from "@reduxjs/toolkit";
import { RootState } from "../../store";
import { PayloadAction } from "@reduxjs/toolkit";

export interface AppState {
  status: "idle" | "initializing" | "ready" | "failed";
  activeChatSessionId: string | null;
  sidebarOpen: boolean;
  isMaximized: boolean;
  initializationError: string | null;
}

const initialState: AppState = {
  status: "idle",
  activeChatSessionId: null,
  sidebarOpen: true,
  isMaximized: false,
  initializationError: null,
};

export const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    initialize: (state) => {
      state.status = "initializing";
      state.initializationError = null;
    },
    initializationComplete: (state) => {
      state.status = "ready";
      state.initializationError = null;
    },
    initializationFailed: (state, action: PayloadAction<string>) => {
      state.status = "failed";
      state.initializationError = action.payload;
    },
    setActiveChatSessionId: (state, action: PayloadAction<string | null>) => {
      state.activeChatSessionId = action.payload;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
    setIsMaximized: (state, action: PayloadAction<boolean>) => {
      state.isMaximized = action.payload;
    },
  },
});

export const {
  initialize,
  initializationComplete,
  initializationFailed,
  setActiveChatSessionId,
  setSidebarOpen,
  setIsMaximized,
} = appSlice.actions;

export const selectApp = (state: RootState) => state.app;

export default appSlice.reducer;
