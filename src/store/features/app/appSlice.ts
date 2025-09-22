import { createSlice } from "@reduxjs/toolkit";
import { RootState } from "../../store";

export interface AppState {
  status: "idle" | "initializing" | "ready";
}

const initialState: AppState = {
  status: "idle",
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
  },
});

export const { initialize, initializationComplete } = appSlice.actions;

export const selectApp = (state: RootState) => state.app;

export default appSlice.reducer;
