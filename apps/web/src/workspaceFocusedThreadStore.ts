import { create } from "zustand";

interface WorkspaceFocusedThreadStore {
  focusedThreadKey: string | null;
  setFocusedThreadKey: (threadKey: string | null) => void;
}

export const useWorkspaceFocusedThreadStore = create<WorkspaceFocusedThreadStore>((set) => ({
  focusedThreadKey: null,
  setFocusedThreadKey: (threadKey) =>
    set((state) =>
      state.focusedThreadKey === threadKey ? state : { focusedThreadKey: threadKey },
    ),
}));
