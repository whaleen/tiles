import { createContext } from "react";

export const ActionCompleteContext = createContext<(() => void) | null>(null);
