import { createSlice } from "@reduxjs/toolkit";
import { RootState } from "../../store";
import { PayloadAction } from "@reduxjs/toolkit";

export interface AppState {
  status: "idle" | "initializing" | "ready";
  activeChatSessionId: string | null;
  sidebarOpen: boolean;
  isMaximized: boolean;
  isBatchRegenerating: boolean;
}

const initialState: AppState = {
  status: "idle",
  activeChatSessionId: null,
  sidebarOpen: true,
  isMaximized: false,
  isBatchRegenerating: false,
};

export const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    initialize: (state) => {
      state.status = "initializing";
    },
    initializationComplete: (state) => {
      state.status = "ready";
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
    setBatchRegenerating: (state, action: PayloadAction<boolean>) => {
      state.isBatchRegenerating = action.payload;
    },
  },
});

export const {
  initialize,
  initializationComplete,
  setActiveChatSessionId,
  setSidebarOpen,
  setIsMaximized,
  setBatchRegenerating,
} = appSlice.actions;

export const selectApp = (state: RootState) => state.app;

export default appSlice.reducer;
