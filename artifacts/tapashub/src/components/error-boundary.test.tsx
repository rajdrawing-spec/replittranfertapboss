import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ErrorBoundary } from "./error-boundary"

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom")
  return <div>ok</div>
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(<ErrorBoundary><div>content</div></ErrorBoundary>)
    expect(screen.getByText("content")).toBeInTheDocument()
  })

  it("shows error UI and retry button when error is thrown", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(screen.getByText("Retry")).toBeInTheDocument()
    consoleError.mockRestore()
  })

})
