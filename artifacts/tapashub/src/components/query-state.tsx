import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { EmptyState, ErrorState } from "@/components/empty-state"

export interface QueryStateProps {
  isLoading: boolean
  /** True once the query has settled into an error. */
  isError: boolean
  /** True once loaded successfully but with nothing to show. */
  isEmpty: boolean
  /** Re-runs the failed query. Omit to hide the Retry button (rare — most
   *  callers have a `refetch` on hand). */
  onRetry?: () => void
  /** Rendered while `isLoading`. Pass a skeleton matched to the content's
   *  shape (a table gets skeleton rows, a stat grid gets skeleton tiles) —
   *  a generic spinner reads as slower than it is. */
  loading: React.ReactNode
  /** Message shown in the error state; falls back to ErrorState's default. */
  errorMessage?: string
  /** Message shown in the empty state; falls back to EmptyState's default. */
  emptyMessage?: string
  /** Secondary line under the empty message, e.g. "Try a different filter". */
  emptyHint?: string
  /** Icon for the empty state — matches the entity being listed. */
  emptyIcon?: LucideIcon
  /** e.g. a "Add first product" button, shown below the empty message/hint. */
  emptyAction?: React.ReactNode
  className?: string
  /**
   * The success-state content.
   *
   * ⚠️ `children` is a normal prop, not real control flow: React builds this
   * JSX at the *call site*, before QueryState ever runs its own
   * isLoading/isError/isEmpty branching — exactly like any other function
   * argument. So anything referenced in here must already be safe to
   * construct in every state, not just the one where it's actually shown.
   *
   * `data?.items ?? []` passed straight to a list/table is fine — mapping an
   * empty array does nothing. `someQueryResult!.field` is not: it throws
   * the moment this element is built, regardless of which branch QueryState
   * was about to pick. If content needs a single possibly-absent object
   * (not an array) rather than a `?? []`-able list, guard it with a real
   * short-circuit — a ternary or `&&` — instead of routing it through here.
   */
  children: React.ReactNode
}

/**
 * Collapses the loading / error / empty / content branches every list page
 * was writing by hand into one place — and, for the 28 of 33 pages that had
 * no error branch at all, adds one. Without it a failed request and an
 * empty result render identically (an empty table), so a user has no way to
 * tell "nothing here yet" from "this broke" or any reason to retry.
 *
 * See the `children` doc above before reaching for this on content that
 * isn't a simple `data ?? []` list.
 */
export function QueryState({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  loading,
  errorMessage,
  emptyMessage,
  emptyHint,
  emptyIcon,
  emptyAction,
  className,
  children,
}: QueryStateProps) {
  if (isLoading) return <>{loading}</>
  if (isError) {
    return (
      <ErrorState className={className} message={errorMessage} onRetry={onRetry} />
    )
  }
  if (isEmpty) {
    return (
      <EmptyState className={className} message={emptyMessage} hint={emptyHint} icon={emptyIcon} action={emptyAction} />
    )
  }
  return <>{children}</>
}
