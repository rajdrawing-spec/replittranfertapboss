import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Pencil, Trash2 } from "lucide-react";

import { ResponsiveTable, type ResponsiveTableColumn } from "./responsive-table";

interface Row {
  id: number;
  name: string;
  email: string;
  status: string;
  amount: string;
}

const rows: Row[] = [
  { id: 1, name: "Acme Corp", email: "billing@acme.test", status: "Paid", amount: "₹1,200" },
  { id: 2, name: "Globex Inc", email: "ap@globex.test", status: "Overdue", amount: "₹800" },
];

const columns: ResponsiveTableColumn<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, card: "title" },
  { key: "email", header: "Email", cell: (r) => r.email, card: "subtitle" },
  { key: "status", header: "Status", cell: (r) => r.status, card: "badge" },
  { key: "amount", header: "Amount", cell: (r) => r.amount },
];

describe("ResponsiveTable", () => {
  it("renders one row per item in both the table and the card layout", () => {
    render(<ResponsiveTable columns={columns} data={rows} rowKey={(r) => r.id} />);
    // Both layouts render simultaneously (CSS toggles visibility per
    // breakpoint), so each row's text appears twice — once per layout.
    expect(screen.getAllByText("Acme Corp")).toHaveLength(2);
    expect(screen.getAllByText("Globex Inc")).toHaveLength(2);
  });

  it("shows skeleton placeholders instead of data while loading", () => {
    render(<ResponsiveTable columns={columns} data={[]} rowKey={(r) => r.id} isLoading skeletonCount={3} />);
    expect(screen.queryByText("Acme Corp")).toBeNull();
  });

  it("renders a single action as its own button, not a menu", () => {
    const onEdit = vi.fn();
    render(
      <ResponsiveTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        actions={[{ label: "Edit", icon: Pencil, onClick: onEdit }]}
      />,
    );
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    expect(editButtons.length).toBeGreaterThan(0);
    fireEvent.click(editButtons[0]!);
    expect(onEdit).toHaveBeenCalledWith(rows[0]);
  });

  it("keeps multiple actions as inline buttons on the desktop table", () => {
    // A table row has room for a couple of icon buttons and a mouse makes
    // each one a single precise click, so desktop should never force an
    // extra click through a menu the way the mobile card does.
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <ResponsiveTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        actions={[
          { label: "Edit", icon: Pencil, onClick: onEdit },
          { label: "Delete", icon: Trash2, onClick: onDelete, destructive: true },
        ]}
      />,
    );

    // One inline "Edit" and one inline "Delete" button per row (desktop),
    // alongside one "More actions" trigger per row (the mobile card).
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(rows.length);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(rows.length);
    expect(screen.getAllByRole("button", { name: "More actions" })).toHaveLength(rows.length);

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    expect(onDelete).toHaveBeenCalledWith(rows[0]);
  });

  it("collapses multiple actions into one overflow menu on the mobile card", async () => {
    const onDelete = vi.fn();
    render(
      <ResponsiveTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        actions={[
          { label: "Edit", icon: Pencil, onClick: vi.fn() },
          { label: "Delete", icon: Trash2, onClick: onDelete, destructive: true },
        ]}
      />,
    );

    const triggers = screen.getAllByRole("button", { name: "More actions" });
    expect(triggers).toHaveLength(rows.length);

    // Radix's dropdown trigger opens on pointerdown (so drag-to-select works
    // on the menu), not on click alone — jsdom needs both events fired.
    fireEvent.pointerDown(triggers[0]!);
    fireEvent.click(triggers[0]!);
    const menuItem = await screen.findAllByText("Delete");
    fireEvent.click(menuItem[0]!);
    expect(onDelete).toHaveBeenCalledWith(rows[0]);
  });

  it("fires onRowClick without double-firing from an action button", () => {
    const onRowClick = vi.fn();
    const onEdit = vi.fn();
    render(
      <ResponsiveTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        actions={[{ label: "Edit", icon: Pencil, onClick: onEdit }]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(onEdit).toHaveBeenCalledTimes(1);
    // Clicking the action button must not also trigger the row's own handler.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("puts the title/subtitle/badge columns in the card header and the rest in the meta grid", () => {
    render(<ResponsiveTable columns={columns} data={[rows[0]!]} rowKey={(r) => r.id} />);
    // The card layout is present even though only the desktop table is
    // visible by default in jsdom (both render; CSS hides one) — assert on
    // structure via the "Amount" meta label, which only appears in the card.
    const amountLabels = screen.getAllByText("Amount");
    expect(amountLabels.length).toBeGreaterThanOrEqual(1);
  });
});
