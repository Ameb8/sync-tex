package yjs

// WrapSyncStep2 wraps a raw state payload as a Yjs sync step 2 message.
// Sent to a new client so it starts from the last persisted document state.
func WrapSyncStep2(payload []byte) []byte {
	out := make([]byte, 2+len(payload))
	out[0] = MsgSync
	out[1] = SyncStep2
	copy(out[2:], payload)
	return out
}

// SaveSignal builds the out-of-band save signal sent to the nominated saver.
// Format: [0xFF, 's', 'a', 'v', 'e']
// The frontend checks for 0xFF as the first byte and reads the ASCII payload.
func SaveSignal() []byte {
	return []byte{SigSave, 's', 'a', 'v', 'e'}
}

// SaveACK builds the acknowledgment the client sends back after a successful save.
// Format: [0xFF, 'a', 'c', 'k']
func SaveACK() []byte {
	return []byte{SigSave, 'a', 'c', 'k'}
}

// IsSignal returns true if msg is an out-of-band relay signal (not Yjs protocol).
func IsSignal(msg []byte) bool {
	return len(msg) > 0 && msg[0] == SigSave
}

// ParseSignal returns the ASCII payload of a signal message (bytes after SigSave).
func ParseSignal(msg []byte) string {
	if len(msg) < 2 {
		return ""
	}
	return string(msg[1:])
}