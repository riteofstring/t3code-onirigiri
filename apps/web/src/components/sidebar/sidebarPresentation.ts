import { createContext } from "react";

export const SidebarPresentationContext = createContext<"default" | "all-conversations">("default");
