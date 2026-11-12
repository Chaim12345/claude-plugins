// Package mobile is the surface the phone apps call, built with gomobile:
//
//	gomobile bind -target=android -o salzol.aar ./mobile     (Android, needs the NDK)
//	gomobile bind -target=ios -o Salzol.xcframework ./mobile (iOS, needs Xcode on a Mac)
//
// gomobile only passes strings, numbers, []byte, errors and interfaces, so config and results are JSON.
package mobile

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

// Listener receives sync progress as JSON-encoded core.Event values.
type Listener interface {
	OnEvent(eventJSON string)
}

var (
	mu     sync.Mutex
	cancel context.CancelFunc
)

// DefaultConfig returns the built-in stores config as JSON.
func DefaultConfig() string {
	b, _ := json.Marshal(core.DefaultConfig())
	return string(b)
}

// Sync downloads whatever is new, rebuilds the catalog and returns the path of catalog.json.
// configJSON may be empty for the default config. Only one sync runs at a time; a second call
// cancels the first.
func Sync(dataDir, configJSON string, l Listener) (string, error) {
	cfg := core.DefaultConfig()
	if configJSON != "" {
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			return "", err
		}
	}
	mu.Lock()
	if cancel != nil {
		cancel()
	}
	ctx, c := context.WithTimeout(context.Background(), 10*time.Minute)
	cancel = c
	mu.Unlock()
	defer c()

	s := &core.Syncer{DataDir: dataDir}
	if l != nil {
		s.OnEvent = func(e core.Event) {
			b, _ := json.Marshal(e)
			l.OnEvent(string(b))
		}
	}
	if _, err := s.Sync(ctx, cfg); err != nil {
		return "", err
	}
	return dataDir + "/catalog.json", nil
}

// CancelSync stops a running sync.
func CancelSync() {
	mu.Lock()
	defer mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

var imgClient = &http.Client{Timeout: 20 * time.Second}

// ResolveImage returns a photo URL for a barcode, or "" if none is known (cached under dataDir).
func ResolveImage(dataDir, code string) string {
	u, _ := core.ResolveImage(context.Background(), imgClient, dataDir, code)
	return u
}
