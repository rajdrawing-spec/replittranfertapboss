/**
 * Registry backing the mobile floating action button.
 *
 * The FAB used to hard-code a label per route and render a button with no
 * click handler at all, so tapping it did nothing — and two of the routes it
 * claimed to serve (CRM, AI Tasks) have no create action to invoke in the
 * first place. Guessing an action from the URL cannot work, because only the
 * page knows how to open its own create dialog.
 *
 * So the page declares the action instead. A page with something to create
 * calls `useFabAction`; the layout renders the button only while an action is
 * registered, which means the FAB is never present unless it does something.
 */
import * as React from "react";

export interface FabAction {
  /** Accessible name, e.g. "Add Product". Also used as the tooltip. */
  label: string;
  /** Invoked on tap. */
  run: () => void;
}

let current: FabAction | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FabAction | null {
  return current;
}

/**
 * Registers this page's primary create action for as long as it is mounted.
 *
 * `label` and `run` are read through a ref so a page can pass an inline
 * closure without re-registering on every render.
 */
export function useFabAction(label: string, run: () => void): void {
  const runRef = React.useRef(run);
  runRef.current = run;

  React.useEffect(() => {
    const action: FabAction = { label, run: () => runRef.current() };
    current = action;
    emit();

    return () => {
      // Only clear if this page's action is still the registered one — on a
      // route change the incoming page may register before the outgoing one
      // has cleaned up, and clearing unconditionally would drop it.
      if (current === action) {
        current = null;
        emit();
      }
    };
  }, [label]);
}

/** The currently registered action, or null when no page has declared one. */
export function useCurrentFabAction(): FabAction | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
