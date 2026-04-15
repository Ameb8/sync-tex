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

// WrapSyncUpdate wraps a raw Yjs update payload as a sync update message.
func WrapSyncUpdate(payload []byte) []byte {
	out := make([]byte, 2+len(payload))
	out[0] = MsgSync
	out[1] = SyncUpdate
	copy(out[2:], payload)
	return out
}
