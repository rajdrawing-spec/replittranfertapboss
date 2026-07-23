/**
 * AiTaskRealtimeContext — placeholder after chat/socket removal.
 * AI task updates are still available via React Query polling.
 */
import * as React from "react";

const AiTaskRealtimeContext = React.createContext<null>(null);

export function AiTaskRealtimeProvider({ children }: { children: React.ReactNode }) {
  return <AiTaskRealtimeContext.Provider value={null}>{children}</AiTaskRealtimeContext.Provider>;
}
