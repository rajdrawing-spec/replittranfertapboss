import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";

import { useCurrentFabAction, useFabAction } from "./fab-action";

/** Minimal stand-in for the layout's FAB: renders only when an action exists. */
function Fab() {
  const action = useCurrentFabAction();
  if (!action) return null;
  return (
    <button type="button" aria-label={action.label} onClick={action.run}>
      +
    </button>
  );
}

function Page({ label, onRun }: { label: string; onRun: () => void }) {
  useFabAction(label, onRun);
  return null;
}

describe("fab action registry", () => {
  it("renders no button when no page has registered an action", () => {
    render(<Fab />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("runs the registered page action when tapped", () => {
    const run = vi.fn();
    render(
      <>
        <Page label="Add Product" onRun={run} />
        <Fab />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));

    // The original bug: the FAB rendered but had no onClick at all, so this
    // count stayed at zero no matter how often it was tapped.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("hides the button again once the page unmounts", () => {
    const { rerender } = render(
      <>
        <Page label="New Order" onRun={() => {}} />
        <Fab />
      </>,
    );
    expect(screen.getByRole("button", { name: "New Order" })).toBeTruthy();

    rerender(<Fab />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("calls the latest handler without re-registering on every render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <>
        <Page label="Add Event" onRun={first} />
        <Fab />
      </>,
    );

    rerender(
      <>
        <Page label="Add Event" onRun={second} />
        <Fab />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Event" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps the incoming action when a route change unmounts the old page last", () => {
    // React can mount the next page before unmounting the previous one. An
    // unconditional cleanup would clear the new page's action and leave the
    // FAB missing on a page that does have a create action.
    const { result } = renderHook(() => useCurrentFabAction());

    const outgoing = render(<Page label="Old" onRun={() => {}} />);
    const incoming = render(<Page label="New" onRun={() => {}} />);
    act(() => outgoing.unmount());

    expect(result.current?.label).toBe("New");
    incoming.unmount();
  });
});
