// Package droid is what the native Android app calls (gomobile bind ./droid). gomobile passes only
// strings, numbers and interfaces, so every screen's data is a JSON string from the engine (app).
// One engine per process, opened with Open(filesDir).
package droid

import (
	"encoding/json"
	"sync"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/ai"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/app"
)

// Listener gets the engine's background events as JSON: {"type":"sync"|"catalog"|"ai"|"state","msg":..}.
type Listener interface {
	OnEvent(eventJSON string)
}

var (
	mu sync.Mutex
	e  *app.Engine
)

func eng() *app.Engine {
	mu.Lock()
	defer mu.Unlock()
	return e
}

func js(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":` + quote(err.Error()) + `}`
	}
	return string(b)
}

func quote(s string) string { b, _ := json.Marshal(s); return string(b) }

// Open starts the engine on the app's private files folder. Safe to call again (keeps the first).
func Open(dir string) error {
	mu.Lock()
	defer mu.Unlock()
	if e != nil {
		return nil
	}
	x, err := app.Open(dir)
	if err != nil {
		return err
	}
	e = x
	return nil
}

func SetListener(l Listener) {
	eng().SetEmitter(func(ev app.Event) {
		if l != nil {
			l.OnEvent(js(ev))
		}
	})
}

// Screens
func Status() string             { return js(eng().Status()) }
func Home() string               { return js(eng().Home()) }
func Product(code string) string { return js(eng().Product(code)) }
func Cart() string               { return js(eng().Cart()) }
func AI() string                 { return js(eng().AI()) }
func AIConfig() string           { return js(eng().AIConfig()) }

// Search takes a SearchReq as JSON: {"q":"...","cat":"dairy","sort":"cheap","onSale":true,"offset":0,"limit":40}.
func Search(reqJSON string) string {
	var r app.SearchReq
	json.Unmarshal([]byte(reqJSON), &r)
	return js(eng().Search(r))
}

// Deals takes a DealsReq as JSON.
func Deals(reqJSON string) string {
	var r app.DealsReq
	json.Unmarshal([]byte(reqJSON), &r)
	return js(eng().Deals(r))
}

// Actions
func SetPlace(name string, lat, lon, radiusKm float64) {
	eng().SetPlace(app.Place{Name: name, Lat: lat, Lon: lon, Radius: radiusKm})
}
func Sync()                             { eng().Sync() }
func CancelSync()                       { eng().CancelSync() }
func SetQty(code string, q float64) int { return eng().SetQty(code, q) }
func ClearCart()                        { eng().ClearCart() }
func ToggleStore(id string)             { eng().ToggleStore(id) }
func SetClub(chain string, on bool)     { eng().SetClub(chain, on) }
func ToggleWatch(code string) bool      { return eng().ToggleWatch(code) }
func SetImages(on bool)                 { eng().SetImages(on) }

// Geocode: {"found":bool,"lat":..,"lon":..,"error":".."}.
func Geocode(q string) string {
	lat, lon, ok, err := eng().Geocode(q)
	m := map[string]any{"found": ok, "lat": lat, "lon": lon}
	if err != nil {
		m["error"] = err.Error()
	}
	return js(m)
}

// AI
func SetAI(configJSON string) {
	var c ai.Config
	if json.Unmarshal([]byte(configJSON), &c) == nil {
		eng().SetAI(c)
	}
}

// TestAI: "" when it works, else the error in Hebrew. Blocks: call it off the main thread.
func TestAI() string { return eng().TestAI() }

// Models: JSON list of model ids. Blocks.
func Models() string {
	m, err := eng().Models()
	if err != nil {
		return js(map[string]any{"error": err.Error()})
	}
	return js(map[string]any{"models": m})
}

func StartAI()   { eng().StartAI() }
func RunEnrich() { go eng().RunEnrich() }
func RunCheck()  { go eng().RunCheck() }
func StopAI()    { eng().StopAI() }
func ClearAI()   { eng().ClearAI() }

// RefreshNow is the background job: sync the saved place, wait for it, then the AI work. Blocks
// up to the timeout; returns "" or an error. Called by WorkManager.
func RefreshNow(timeoutSec int) string { return eng().RefreshNow(timeoutSec) }
