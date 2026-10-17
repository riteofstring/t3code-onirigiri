import { create } from "zustand";

/**
 * The thread an embedding workspace has in focus. The sidebar highlights it at
 * once, while the route follows focus only after navigation pauses. Null leaves
 * the highlight to the route.
 */
interface WorkspaceFocusedThreadStore {
  focusedThreadKey: string | null;
  setFocusedThreadKey: (threadKey: string | null) => void;
}

export const useWorkspaceFocusedThreadStore = create<WorkspaceFocusedThreadStore>((set) => ({
  focusedThreadKey: null,
  setFocusedThreadKey: (threadKey) =>
    set((state) => (state.focusedThreadKey === threadKey ? state : { focusedThreadKey: threadKey })),
}));
