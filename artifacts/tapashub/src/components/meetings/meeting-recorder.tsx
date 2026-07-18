/**
 * MeetingRecorder — captures the meeting's mixed audio (local mic + all remote
 * participants) inside the shared LiveKitRoom and hands the recording to the
 * AI Meeting Assistant when the call ends.
 *
 * Chunks are held in a module-level store keyed by meetingId so the recording
 * survives LiveKitRoom remounts (the room is keyed on the token, which changes
 * on reconnects). `finishRecording()` is called by the meeting context when
 * the user actually leaves the call.
 */
import * as React from "react"
import { useRoomContext } from "@livekit/components-react"
import { RoomEvent, Track, type RemoteTrack, type Room } from "livekit-client"

interface RecordingState {
  chunks: Blob[]
  recorder: MediaRecorder | null
  audioCtx: AudioContext | null
  dest: MediaStreamAudioDestinationNode | null
  sources: Map<string, MediaStreamAudioSourceNode>
  mimeType: string
}

const recordings = new Map<string, RecordingState>()

const MAX_UPLOAD_BYTES = 28 * 1024 * 1024 // stay under the server's 30MB cap

function getState(meetingId: string): RecordingState {
  let s = recordings.get(meetingId)
  if (!s) {
    s = { chunks: [], recorder: null, audioCtx: null, dest: null, sources: new Map(), mimeType: "audio/webm" }
    recordings.set(meetingId, s)
  }
  return s
}

function connectTrack(state: RecordingState, key: string, mediaStreamTrack: MediaStreamTrack) {
  if (!state.audioCtx || !state.dest || state.sources.has(key)) return
  try {
    const stream = new MediaStream([mediaStreamTrack])
    const source = state.audioCtx.createMediaStreamSource(stream)
    source.connect(state.dest)
    state.sources.set(key, source)
  } catch (e) {
    console.debug("[recorder] failed to connect track:", e)
  }
}

function disconnectTrack(state: RecordingState, key: string) {
  const source = state.sources.get(key)
  if (source) {
    try { source.disconnect() } catch { /* noop */ }
    state.sources.delete(key)
  }
}

/**
 * Stop recording, upload the captured audio to the AI notes pipeline, and
 * clear local state. Called by the meeting context when the call ends.
 * Best-effort: never throws.
 */
export async function finishRecording(meetingId: string): Promise<void> {
  const state = recordings.get(meetingId)
  if (!state) return
  recordings.delete(meetingId)
  try {
    if (state.recorder && state.recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        state.recorder!.onstop = () => resolve()
        try { state.recorder!.stop() } catch { resolve() }
        // Safety net if onstop never fires
        setTimeout(resolve, 2000)
      })
    }
    state.sources.forEach((s) => { try { s.disconnect() } catch { /* noop */ } })
    if (state.audioCtx && state.audioCtx.state !== "closed") {
      state.audioCtx.close().catch(() => {})
    }

    const blob = new Blob(state.chunks, { type: state.mimeType })
    // Skip trivial recordings (a couple of seconds of silence isn't a meeting)
    if (blob.size < 20_000) return
    if (blob.size > MAX_UPLOAD_BYTES) {
      console.warn("[recorder] recording too large to upload for AI notes:", blob.size)
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    await fetch(`/api/meetings/audio/${encodeURIComponent(meetingId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: dataUrl }),
    })
  } catch (e) {
    console.debug("[recorder] finishRecording failed:", e)
  }
}

/** Discard a recording without uploading (e.g. join failed). */
export function discardRecording(meetingId: string): void {
  const state = recordings.get(meetingId)
  if (!state) return
  recordings.delete(meetingId)
  try { state.recorder?.state !== "inactive" && state.recorder?.stop() } catch { /* noop */ }
  if (state.audioCtx && state.audioCtx.state !== "closed") state.audioCtx.close().catch(() => {})
}

function attachRoom(room: Room, state: RecordingState) {
  // Local microphone
  const attachLocal = () => {
    room.localParticipant.audioTrackPublications.forEach((pub) => {
      if (pub.track?.mediaStreamTrack) {
        connectTrack(state, `local:${pub.trackSid}`, pub.track.mediaStreamTrack)
      }
    })
  }
  attachLocal()
  // Remote participants already publishing
  room.remoteParticipants.forEach((p) => {
    p.audioTrackPublications.forEach((pub) => {
      if (pub.track?.mediaStreamTrack) {
        connectTrack(state, `remote:${pub.trackSid}`, pub.track.mediaStreamTrack)
      }
    })
  })

  const onTrackSubscribed = (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio && track.mediaStreamTrack) {
      connectTrack(state, `remote:${track.sid}`, track.mediaStreamTrack)
    }
  }
  const onTrackUnsubscribed = (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) disconnectTrack(state, `remote:${track.sid}`)
  }
  const onLocalPublished = () => attachLocal()

  room.on(RoomEvent.TrackSubscribed, onTrackSubscribed)
  room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
  room.on(RoomEvent.LocalTrackPublished, onLocalPublished)
  return () => {
    room.off(RoomEvent.TrackSubscribed, onTrackSubscribed)
    room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    room.off(RoomEvent.LocalTrackPublished, onLocalPublished)
  }
}

export function MeetingRecorder({ meetingId }: { meetingId: string }) {
  const room = useRoomContext()

  React.useEffect(() => {
    if (!room || typeof MediaRecorder === "undefined") return
    const state = getState(meetingId)

    // (Re)create the mixing graph for this mount. Chunks persist across mounts.
    if (!state.audioCtx || state.audioCtx.state === "closed") {
      try {
        state.audioCtx = new AudioContext()
        state.dest = state.audioCtx.createMediaStreamDestination()
        state.sources = new Map()
      } catch (e) {
        console.debug("[recorder] AudioContext unavailable:", e)
        return
      }
    }

    // Clear stale source nodes from a previous room instance (the LiveKitRoom
    // remounts with a new Room object on every token refresh); old
    // MediaStreamAudioSourceNodes reference dead tracks and would block
    // reattachment of the same track keys.
    state.sources.forEach((s) => { try { s.disconnect() } catch { /* noop */ } })
    state.sources.clear()

    const detach = attachRoom(room, state)

    // Start (or restart after a remount) the MediaRecorder
    if (!state.recorder || state.recorder.state === "inactive") {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm"
      try {
        const recorder = new MediaRecorder(state.dest!.stream, { mimeType, audioBitsPerSecond: 32_000 })
        state.mimeType = "audio/webm"
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) state.chunks.push(e.data)
        }
        recorder.start(5_000)
        state.recorder = recorder
      } catch (e) {
        console.debug("[recorder] MediaRecorder unavailable:", e)
      }
    }

    return () => {
      detach()
      // Do NOT stop the recorder here — the room may just be remounting with a
      // fresh token. finishRecording() (called on actual leave) stops it.
    }
  }, [room, meetingId])

  return null
}
