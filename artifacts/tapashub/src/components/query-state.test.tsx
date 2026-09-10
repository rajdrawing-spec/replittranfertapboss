import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { QueryState } from "./query-state";

describe("QueryState", () => {
  it("renders the loading fallback while isLoading, not the content", () => {
    render(
      <QueryState isLoading isError={false} isEmpty={false} loading={<div>Loading…</div>}>
        <div>Content</div>
      </QueryState>,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("Content")).toBeNull();
  });

  it("renders an error state with a working retry button when the query failed", () => {
    const onRetry = vi.fn();
    render(
      <QueryState
        isLoading={false}
        isError
        isEmpty={false}
        onRetry={onRetry}
        loading={<div>Loading…</div>}
        errorMessage="Could not load orders."
      >
        <div>Content</div>
      </QueryState>,
    );
    expect(screen.getByText("Could not load orders.")).toBeTruthy();
    expect(screen.queryByText("Content")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when loaded successfully with nothing to show", () => {
    render(
      <QueryState
        isLoading={false}
        isError={false}
        isEmpty
        loading={<div>Loading…</div>}
        emptyMessage="No orders found"
      >
        <div>Content</div>
      </QueryState>,
    );
    expect(screen.getByText("No orders found")).toBeTruthy();
    expect(screen.queryByText("Content")).toBeNull();
  });

  it("renders the children once loaded, not-errored, and non-empty", () => {
    render(
      <QueryState isLoading={false} isError={false} isEmpty={false} loading={<div>Loading…</div>}>
        <div>Content</div>
      </QueryState>,
    );
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("prioritizes loading over error and empty", () => {
    // A query can be simultaneously "loading a retry" and still carrying a
    // stale error/empty flag from the previous attempt — loading must win so
    // a retry doesn't flash the old error state before the new result lands.
    render(
      <QueryState isLoading isError isEmpty loading={<div>Loading…</div>} errorMessage="err" emptyMessage="empty">
        <div>Content</div>
      </QueryState>,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});
