// Package droid is what the native Android app calls (gomobile bind ./droid). gomobile passes only
// strings, numbers and interfaces, so every screen's data is a JSON string from the engine (app).
// One engine per process, opened with Open(filesDir).
package droid

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/ai"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/app"
)

// Listener gets the engine's background events as JSON: {"type":"sync"|"catalog"|"ai"|"state","msg":..}.
type Listener interface {
	OnEvent(eventJSON string)
}

var (
	mu  sync.Mutex
	e   *app.Engine
	dir string
)

func eng() *app.Engine {
	mu.Lock()
	defer mu.Unlock()
	return e
}

// guard turns a Go panic in a call from the UI into an error the screen can show (and a line in
// go-errors.txt) instead of killing the app.
func guard(out *string) {
	if r := recover(); r != nil {
		msg := fmt.Sprintf("%v", r)
		logErr(msg + "\n" + string(debug.Stack()))
		if out != nil {
			*out = `{"error":` + quote(msg) + `}`
		}
	}
}

func logErr(s string) {
	if dir == "" {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "go-errors.txt"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		fmt.Fprintf(f, "%s %s\n", time.Now().Format(time.RFC3339), s)
		f.Close()
	}
}

// Errors returns what went wrong in Go since the last call (panics caught, and a fatal crash of the
// previous run), and clears it.
func Errors() string {
	var out string
	for _, n := range []string{"go-crash.txt", "go-errors.txt"} {
		p := filepath.Join(dir, n)
		if b, err := os.ReadFile(p); err == nil && len(b) > 0 {
			out += "== " + n + "\n" + string(b) + "\n"
			os.Remove(p)
		}
	}
	return out
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
// A fatal Go error (one recover can't catch) is written to go-crash.txt for the next start to show.
func Open(d string) error {
	mu.Lock()
	defer mu.Unlock()
	if e != nil {
		return nil
	}
	dir = d
	if f, err := os.OpenFile(filepath.Join(d, "go-crash.txt"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		debug.SetCrashOutput(f, debug.CrashOptions{})
		f.Close()
	}
	app.OnPanic = logErr
	x, err := app.Open(d)
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
func Status() (out string)             { defer guard(&out); return js(eng().Status()) }
func Home() (out string)               { defer guard(&out); return js(eng().Home()) }
func Product(code string) (out string) { defer guard(&out); return js(eng().Product(code)) }
func Cart() (out string)               { defer guard(&out); return js(eng().Cart()) }
func AI() (out string)                 { defer guard(&out); return js(eng().AI()) }

func AIConfig() (out string) { defer guard(&out); return js(eng().AIConfig()) }

// Search takes a SearchReq as JSON: {"q":"...","cat":"dairy","sort":"cheap","onSale":true,"offset":0,"limit":40}.
func Search(reqJSON string) (out string) {
	defer guard(&out)
	var r app.SearchReq
	json.Unmarshal([]byte(reqJSON), &r)
	return js(eng().Search(r))
}

// Deals takes a DealsReq as JSON.
func Deals(reqJSON string) (out string) {
	defer guard(&out)
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
func RunEnrich() { go func() { defer guard(nil); eng().RunEnrich() }() }
func RunCheck()  { go func() { defer guard(nil); eng().RunCheck() }() }
func StopAI()    { eng().StopAI() }
func ClearAI()   { eng().ClearAI() }

// RefreshNow is the background job: sync the saved place, wait for it, then the AI work. Blocks
// up to the timeout; returns "" or an error. Called by WorkManager.
func RefreshNow(timeoutSec int) string { return eng().RefreshNow(timeoutSec) }

// ---- features

func Changes() (out string)  { defer guard(&out); return js(eng().Changes()) }
func Watched() (out string)  { defer guard(&out); return js(eng().Watched()) }
func Lists() (out string)    { defer guard(&out); return js(eng().Lists()) }
func Analysis() (out string) { defer guard(&out); return js(eng().Analysis()) }
func LogText() (out string)  { defer guard(&out); return eng().LogText() }
func CartText() (out string) { defer guard(&out); return eng().CartText() }

// Shop is the in-store checklist for a branch ("" = the cheapest for the cart).
func Shop(storeID string) (out string) { defer guard(&out); return js(eng().Shop(storeID)) }
func SetChecked(code string, on bool)  { eng().SetChecked(code, on) }

func SaveList(name string)           { eng().SaveList(name) }
func LoadList(id string, merge bool) { eng().LoadList(id, merge) }
func DeleteList(id string)           { eng().DeleteList(id) }

// ParseList matches a pasted shopping list to products: JSON [{line,qty,code,name,price,alts}].
func ParseList(text string) (out string) { defer guard(&out); return js(eng().ParseList(text)) }

// AddMany adds {"code":qty,...} to the cart.
func AddMany(itemsJSON string) {
	var m map[string]float64
	if json.Unmarshal([]byte(itemsJSON), &m) == nil {
		eng().AddMany(m)
	}
}

// Lookup: the product code for a scanned barcode, or "".
func Lookup(barcode string) string { return eng().Lookup(barcode) }

// TakeNotices: watched products that got cheaper, not shown yet (JSON list); the background job posts them.
func TakeNotices() (out string) { defer guard(&out); return js(eng().TakeNotices()) }
