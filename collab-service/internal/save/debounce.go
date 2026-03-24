package save

import (
	"sync"
	"time"
)

// debounceTimer wraps time.AfterFunc with a reset-safe API.
// Calling reset() while the timer is pending cancels the previous fire
// and starts a fresh window, so rapid edits collapse into one save.
type debounceTimer struct {
	mu    sync.Mutex
	delay time.Duration
	fn    func()
	t     *time.Timer
}

func newDebounceTimer(fn func()) *debounceTimer {
	return &debounceTimer{
		delay: 5 * time.Second, // overridden by Coordinator at Schedule time
		fn:    fn,
	}
}

// setDelay configures the debounce window. Call before the first reset().
func (d *debounceTimer) setDelay(delay time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.delay = delay
}

// reset cancels any in-flight timer and starts a new one.
func (d *debounceTimer) reset() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.t != nil {
		d.t.Stop()
	}
	d.t = time.AfterFunc(d.delay, d.fn)
}

// stop cancels the timer without firing.
func (d *debounceTimer) stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.t != nil {
		d.t.Stop()
		d.t = nil
	}
}