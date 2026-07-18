/**
 * Legacy /meetings route — meetings now live in the Team section (/chat).
 *
 * Kept only so old deep links (e.g. "/meetings?join=<meetingId>" from meeting
 * invites and notifications) keep working: we redirect to /chat and preserve
 * the query string so the Team page's auto-join picks it up.
 */
import * as React from "react"
import { useLocation } from "wouter"

export default function MeetingsRedirect() {
  const [, setLocation] = useLocation()

  React.useEffect(() => {
    const search = window.location.search
    setLocation(`/chat${search}`, { replace: true })
  }, [setLocation])

  return null
}
