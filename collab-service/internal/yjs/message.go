package yjs

// Yjs binary wire format — first two bytes of every message:
//
//   msg[0] = outer type
//     0 = sync      (document state exchange)
//     1 = awareness (cursors, presence)
//
//   msg[1] = inner type (only meaningful when outer == sync)
//     0 = sync step 1  — client sends its state vector, requests missing updates
//     1 = sync step 2  — server responds with updates client is missing
//     2 = update       — incremental document update after initial sync
//
// The relay never decodes the payload itself — it treats updates as opaque
// blobs. Only the type bytes matter for routing and persistence decisions.

const (
	MsgSync      	byte = 0
	MsgAwareness	byte = 1

	SyncStep1 		byte = 0
	SyncStep2 		byte = 1
	SyncUpdate 		byte = 2

	// SigSave is a custom signal byte the relay prepends to out-of-band
	// messages directed at a specific client. Not part of the Yjs protocol.
	// Format: [SigSave, ...asciiPayload]
	SigSave 		byte = 0xFF
)

// Message is the parsed envelope of a Yjs WebSocket frame.
type Message struct {
	Outer   byte
	Inner   byte   // only valid when Outer == MsgSync
	Payload []byte // bytes after the envelope
}

// Parse reads the first two bytes of msg and returns a Message.
// Returns ok=false if the message is too short to be valid.
func Parse(msg []byte) (m Message, ok bool) {
	if len(msg) < 1 {
		return m, false
	}
	m.Outer = msg[0]
	if m.Outer == MsgAwareness {
		m.Payload = safeSlice(msg, 1)
		return m, true
	}
	if m.Outer == MsgSync {
		if len(msg) < 2 {
			return m, false
		}
		m.Inner = msg[1]
		m.Payload = safeSlice(msg, 2)
		return m, true
	}
	return m, false
}

// IsDocUpdate returns true for messages that mutate document state.
// Awareness messages and sync-step-1 requests do not mutate state.
func (m Message) IsDocUpdate() bool {
	return m.Outer == MsgSync && (m.Inner == SyncUpdate || m.Inner == SyncStep2)
}

// IsViewerBlocked returns true if this message type must be dropped from viewers.
// Viewers may send awareness (cursor position) but must not push document updates.
func (m Message) IsViewerBlocked() bool {
	return m.Outer == MsgSync && m.Inner != SyncStep1
}

func safeSlice(b []byte, from int) []byte {
	if from >= len(b) {
		return nil
	}
	return b[from:]
}