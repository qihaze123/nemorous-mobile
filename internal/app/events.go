package app

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Hub fans a cheap invalidation signal out to connected clients. Payloads are
// refetched over the normal REST API; the stream only says "something changed".
type Hub struct {
	mu   sync.Mutex
	subs map[chan struct{}]struct{}
}

func newHub() *Hub {
	return &Hub{subs: map[chan struct{}]struct{}{}}
}

func (h *Hub) subscribe() chan struct{} {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *Hub) unsubscribe(ch chan struct{}) {
	h.mu.Lock()
	delete(h.subs, ch)
	h.mu.Unlock()
}

// notify wakes every client; a slow client keeps only one pending signal.
func (h *Hub) notify() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (a *App) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "当前连接不支持事件流")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "retry: 3000\n\n")
	flusher.Flush()

	ch := a.hub.subscribe()
	defer a.hub.unsubscribe(ch)
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ch:
			fmt.Fprint(w, "event: invalidate\ndata: {}\n\n")
			flusher.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
