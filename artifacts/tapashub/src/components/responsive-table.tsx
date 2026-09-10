import * as React from "react"
import { MoreVertical, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * A data grid that renders as a real `<table>` at `md` and up, and as a
 * stack of cards below it.
 *
 * Every list page in the app wrapped a 7-8 column table in `overflow-x-auto`
 * and left it at that, so reading a single row on a phone means pinching and
 * scrolling sideways. One component fixes it everywhere it's adopted: define
 * the columns once, get both layouts.
 *
 * The mobile card leads with the column marked `card: "title"`, a `card:
 * "subtitle"` line under it, a `card: "badge"` column pinned top-right (e.g.
 * status), the rest as label/value pairs, and row actions collapsed into one
 * overflow menu — matching how every native list UI on a phone reads a row.
 */
export interface ResponsiveTableColumn<T> {
  /** Unique key; also keys the card's label/value row when `card` is "meta". */
  key: string
  header: React.ReactNode
  /** Desktop table cell content. */
  cell: (row: T) => React.ReactNode
  headClassName?: string
  cellClassName?: string
  /**
   * Mobile card placement:
   * - "title": the card's leading line. Exactly one column should use this.
   * - "subtitle": a muted line under the title. At most one.
   * - "badge": pinned to the card header's top-right (e.g. a status pill).
   * - "meta" (default): a label/value row in the card body.
   * - "hidden": omitted from the card — for columns redundant with the
   *   title/subtitle, or too wide to usefully compress (e.g. long notes).
   */
  card?: "title" | "subtitle" | "badge" | "meta" | "hidden"
  /** Overrides `cell` for the card rendering; falls back to `cell`. */
  cardCell?: (row: T) => React.ReactNode
}

export interface ResponsiveTableAction<T> {
  label: string
  icon: LucideIcon
  onClick: (row: T) => void
  destructive?: boolean
  disabled?: (row: T) => boolean
  /** Hides this action for a given row, e.g. a status-gated action. */
  hidden?: (row: T) => boolean
}

export interface ResponsiveTableProps<T> {
  columns: ResponsiveTableColumn<T>[]
  data: T[]
  rowKey: (row: T) => React.Key
  actions?: ResponsiveTableAction<T>[]
  onRowClick?: (row: T) => void
  /** Extra classes for a row's <TableRow>/<Card> — e.g. dimming a voided entry. */
  rowClassName?: (row: T) => string | undefined
  /** Skeleton rows/cards shown while `isLoading`. */
  isLoading?: boolean
  skeletonCount?: number
  className?: string
}

function ActionButton<T>({ row, action }: { row: T; action: ResponsiveTableAction<T> }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn("w-9 h-9 md:w-7 md:h-7", action.destructive && "text-destructive hover:text-destructive")}
      onClick={(e) => {
        e.stopPropagation()
        action.onClick(row)
      }}
      disabled={action.disabled?.(row)}
      aria-label={action.label}
    >
      <action.icon className="w-3.5 h-3.5" />
    </Button>
  )
}

/**
 * Desktop actions cell: every visible action as its own icon button. A
 * table row has room for 2-3 inline actions, and a mouse makes each one a
 * single precise click — turning that into a menu would be one more click
 * for no benefit to a desktop user.
 */
function InlineRowActions<T>({ row, actions }: { row: T; actions: ResponsiveTableAction<T>[] }) {
  const visible = actions.filter((a) => !a.hidden?.(row))
  if (visible.length === 0) return null
  return (
    <div className="flex gap-1">
      {visible.map((action) => (
        <ActionButton key={action.label} row={row} action={action} />
      ))}
    </div>
  )
}

/**
 * Mobile card corner: a card has no room for several icon buttons next to
 * the title and badge, so multiple actions collapse into one overflow menu
 * — the pattern every native mobile list uses. A single action still gets
 * its own button; opening a menu for one item is friction with no payoff.
 */
function RowActionsMenu<T>({ row, actions }: { row: T; actions: ResponsiveTableAction<T>[] }) {
  const visible = actions.filter((a) => !a.hidden?.(row))
  if (visible.length === 0) return null

  if (visible.length === 1) {
    return <ActionButton row={row} action={visible[0]!} />
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="w-9 h-9 md:w-7 md:h-7"
          onClick={(e) => e.stopPropagation()}
          aria-label="More actions"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </Button>
      </DropdownMenuTrigger>
      {/* Radix portals this to document.body, so its clicks never bubble to
          the row's onClick — no stopPropagation needed here. */}
      <DropdownMenuContent align="end">
        {visible.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onClick={() => action.onClick(row)}
            disabled={action.disabled?.(row)}
            className={cn(action.destructive && "text-destructive focus:text-destructive")}
          >
            <action.icon className="w-4 h-4 mr-2" />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ResponsiveTable<T>({
  columns,
  data,
  rowKey,
  actions = [],
  onRowClick,
  rowClassName,
  isLoading,
  skeletonCount = 6,
  className,
}: ResponsiveTableProps<T>) {
  const titleCol = columns.find((c) => c.card === "title")
  const subtitleCol = columns.find((c) => c.card === "subtitle")
  const badgeCol = columns.find((c) => c.card === "badge")
  const metaCols = columns.filter((c) => !c.card || c.card === "meta")

  return (
    <div className={className}>
      {/* Desktop / tablet: real table. */}
      <div className="hidden md:block overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.headClassName}>{c.header}</TableHead>
              ))}
              {actions.length > 0 && <TableHead className="w-16" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonCount }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length + (actions.length > 0 ? 1 : 0)}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              data.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  className={cn("hover:bg-muted/30", onRowClick && "cursor-pointer", rowClassName?.(row))}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.cellClassName}>{c.cell(row)}</TableCell>
                  ))}
                  {actions.length > 0 && (
                    <TableCell>
                      <InlineRowActions row={row} actions={actions} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards. */}
      <div className="md:hidden space-y-2">
        {isLoading
          ? Array.from({ length: skeletonCount }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))
          : data.map((row) => (
              <Card
                key={rowKey(row)}
                className={cn(onRowClick && "cursor-pointer active:bg-muted/40", rowClassName?.(row))}
                onClick={() => onRowClick?.(row)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {titleCol && (
                        <div className="font-medium text-sm truncate">
                          {(titleCol.cardCell ?? titleCol.cell)(row)}
                        </div>
                      )}
                      {subtitleCol && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {(subtitleCol.cardCell ?? subtitleCol.cell)(row)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {badgeCol && (badgeCol.cardCell ?? badgeCol.cell)(row)}
                      {actions.length > 0 && <RowActionsMenu row={row} actions={actions} />}
                    </div>
                  </div>

                  {metaCols.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-border/60">
                      {metaCols.map((c) => (
                        <div key={c.key} className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 truncate">
                            {c.header}
                          </div>
                          <div className="text-sm truncate">{(c.cardCell ?? c.cell)(row)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  )
}
