// Package app is the whole app's logic and state in Go: the place and the branches, the cart, club
// cards, syncs, the catalog index, deals, the basket comparison and the AI work. The native UI
// (Kotlin/Compose, via the droid package) only draws what it returns: every method answers with
// JSON shaped for one screen, with prices already formatted and labels in Hebrew.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/ai"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// Place is where the user shops.
type Place struct {
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	Radius float64 `json:"radius"`
}

// State is everything the user set, saved in state.json.
type State struct {
	Place  *Place             `json:"place,omitempty"`
	Cart   map[string]float64 `json:"cart"`
	Off    []string           `json:"off"`  // store ids left out of the comparison
	Club   shop.Club          `json:"club"` // chains whose club card the user has
	Watch  []string           `json:"watch"`
	Freq   map[string]int     `json:"freq"` // times each product went into the cart
	AI     ai.Config          `json:"ai"`
	Usage  Usage              `json:"usage"`
	Images bool               `json:"images"` // show product photos
}

// Usage counts today's classification requests against the daily cap.
type Usage struct {
	Day string `json:"day"`
	N   int    `json:"n"`
}

// Event is pushed to the UI when something changed in the background.
type Event struct {
	Type string `json:"type"` // "sync", "catalog", "state", "ai"
	Msg  string `json:"msg,omitempty"`
	Done int    `json:"done,omitempty"`
	Of   int    `json:"of,omitempty"`
}

// Engine is the app. One per process (see droid).
type Engine struct {
	dir string
	cl  *ai.Client

	mu       sync.RWMutex
	st       State
	ix       *shop.Index
	deals    []*shop.Deal // every deal at the active branches, the model's answers applied
	dealsKey string
	store    *ai.Store
	verdicts *ai.Verdicts

	syncing  bool
	syncMsg  string
	syncErr  string
	syncStop context.CancelFunc
	aiRun    *aiStatus
	aiStop   context.CancelFunc
	building bool

	emit func(Event)
}

type aiStatus struct {
	Kind  string `json:"kind"` // "enrich", "check"
	Done  int    `json:"done"`
	Of    int    `json:"of"`
	Added int    `json:"added"`
	Err   string `json:"err,omitempty"`
	At    int64  `json:"at,omitempty"`
	Live  bool   `json:"live"`
}

// Open loads the saved state, the AI records and the last catalog (indexed in the background).
func Open(dir string) (*Engine, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	e := &Engine{dir: dir, cl: ai.DefaultClient, emit: func(Event) {}}
	e.st = State{Cart: map[string]float64{}, Club: shop.Club{}, Freq: map[string]int{}, AI: ai.DefaultConfig(), Images: true}
	if b, err := os.ReadFile(filepath.Join(dir, "state.json")); err == nil {
		json.Unmarshal(b, &e.st)
	}
	if e.st.Cart == nil {
		e.st.Cart = map[string]float64{}
	}
	if e.st.Club == nil {
		e.st.Club = shop.Club{}
	}
	if e.st.Freq == nil {
		e.st.Freq = map[string]int{}
	}
	st, err := ai.OpenStore(dir)
	if err != nil {
		return nil, err
	}
	e.store, e.verdicts = st, ai.OpenVerdicts(dir)
	go e.loadCatalog(false)
	return e, nil
}

// SetEmitter sets where background events go (the UI's listener).
func (e *Engine) SetEmitter(f func(Event)) {
	e.mu.Lock()
	e.emit = f
	e.mu.Unlock()
}

func (e *Engine) send(ev Event) {
	e.mu.RLock()
	f := e.emit
	e.mu.RUnlock()
	f(ev)
}

func (e *Engine) save() {
	b, _ := json.Marshal(e.st)
	tmp := filepath.Join(e.dir, "state.json.tmp")
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, filepath.Join(e.dir, "state.json"))
	}
}

// loadCatalog reads catalog.json and builds the index; afterSync starts the AI work.
func (e *Engine) loadCatalog(afterSync bool) {
	b, err := os.ReadFile(filepath.Join(e.dir, "catalog.json"))
	if err != nil {
		return
	}
	var c core.Catalog
	if json.Unmarshal(b, &c) != nil {
		return
	}
	e.mu.Lock()
	e.building = true
	e.mu.Unlock()
	ix, err := shop.FromCatalog(&c, e.store.Records())
	e.mu.Lock()
	e.building = false
	if err == nil {
		e.ix, e.deals, e.dealsKey = ix, nil, ""
	}
	e.mu.Unlock()
	e.send(Event{Type: "catalog"})
	if afterSync {
		go e.autoAI()
	}
}

// active: the indexes of the stores being compared.
func (e *Engine) active() []int {
	if e.ix == nil {
		return nil
	}
	var out []int
	for i, s := range e.ix.Stores {
		if !slices.Contains(e.st.Off, s.ID) {
			out = append(out, i)
		}
	}
	return out
}

// dealsNow: the deals at the active branches, built once per catalog / branches / club cards.
func (e *Engine) dealsNow() []*shop.Deal {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.ix == nil {
		return nil
	}
	act := e.active()
	var club []string
	for k, v := range e.st.Club {
		if v {
			club = append(club, k)
		}
	}
	sort.Strings(club)
	key := strings.Join(e.st.Off, ",") + "|" + strings.Join(club, ",")
	if e.deals == nil || e.dealsKey != key {
		e.deals, e.dealsKey = e.ix.BuildDeals(act, e.st.Club, time.Now()), key
		e.verdicts.Apply(e.deals, time.Now())
	}
	return e.deals
}

// ---------- the place and sync ----------

const nearbyMax = 18

// SetPlace saves where the user shops and syncs its branches.
func (e *Engine) SetPlace(p Place) {
	if p.Radius <= 0 {
		p.Radius = 4
	}
	e.mu.Lock()
	e.st.Place, e.st.Off = &p, nil
	e.save()
	e.mu.Unlock()
	e.Sync()
}

// Sync downloads whatever is new for the place's branches and rebuilds the catalog, in the background.
func (e *Engine) Sync() {
	e.mu.Lock()
	if e.syncing || e.st.Place == nil {
		e.mu.Unlock()
		return
	}
	p := *e.st.Place
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	e.syncing, e.syncMsg, e.syncErr, e.syncStop = true, "מחפש סניפים…", "", cancel
	e.mu.Unlock()
	e.send(Event{Type: "sync", Msg: "מחפש סניפים…"})
	go func() {
		defer cancel()
		err := e.syncNow(ctx, p)
		e.mu.Lock()
		e.syncing, e.syncStop = false, nil
		if err != nil {
			e.syncErr = err.Error()
		}
		e.mu.Unlock()
		if err != nil {
			e.send(Event{Type: "sync", Msg: e.syncErr})
			return
		}
		e.loadCatalog(true)
		e.send(Event{Type: "sync"})
	}()
}

func (e *Engine) syncNow(ctx context.Context, p Place) error {
	d, err := core.LoadDirectory(e.dir)
	if err != nil {
		return err
	}
	near := d.Nearby(p.Lat, p.Lon, p.Radius, nearbyMax)
	if len(near) == 0 {
		return errors.New("אין סניפים מוכרים בטווח הזה. נסו מרחק גדול יותר.")
	}
	cfg := core.ConfigFor(near, p.Name, p.Lat, p.Lon)
	parsed := 0
	s := &core.Syncer{DataDir: e.dir, OnEvent: func(ev core.Event) {
		msg := ""
		switch ev.Phase {
		case "download", "cached", "skip":
			msg = "בודק מחירונים חדשים…"
		case "parse":
			parsed++
			msg = "מעבד מחירונים… " + itoa(parsed) + " סניפים"
		case "build":
			msg = "בונה את הקטלוג…"
		default:
			return
		}
		e.mu.Lock()
		e.syncMsg = msg
		e.mu.Unlock()
		e.send(Event{Type: "sync", Msg: msg})
	}}
	_, err = s.Sync(ctx, cfg)
	return err
}

// CancelSync stops a running sync.
func (e *Engine) CancelSync() {
	e.mu.Lock()
	if e.syncStop != nil {
		e.syncStop()
	}
	e.mu.Unlock()
}

// Geocode finds an address: {"found":bool,"lat":..,"lon":..}.
func (e *Engine) Geocode(q string) (lat, lon float64, ok bool, err error) {
	g := core.NewGeocoder(filepath.Join(e.dir, "geocode.json"))
	ll, ok, err := g.LookupAddress(context.Background(), q)
	g.Save()
	return ll[0], ll[1], ok, err
}

// ---------- the cart and settings ----------

// SetQty sets a cart quantity (0 removes it) and returns the number of items in the cart.
func (e *Engine) SetQty(code string, q float64) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	if q <= 0 {
		delete(e.st.Cart, code)
	} else {
		if _, had := e.st.Cart[code]; !had {
			e.st.Freq[code]++
		}
		e.st.Cart[code] = q
	}
	e.save()
	return len(e.st.Cart)
}

func (e *Engine) ClearCart() {
	e.mu.Lock()
	e.st.Cart = map[string]float64{}
	e.save()
	e.mu.Unlock()
}

// ToggleStore includes or leaves out a branch.
func (e *Engine) ToggleStore(id string) {
	e.mu.Lock()
	if i := slices.Index(e.st.Off, id); i >= 0 {
		e.st.Off = slices.Delete(e.st.Off, i, i+1)
	} else {
		e.st.Off = append(e.st.Off, id)
	}
	e.save()
	e.mu.Unlock()
}

func (e *Engine) SetClub(chain string, on bool) {
	e.mu.Lock()
	e.st.Club[chain] = on
	e.save()
	e.mu.Unlock()
}

func (e *Engine) ToggleWatch(code string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if i := slices.Index(e.st.Watch, code); i >= 0 {
		e.st.Watch = slices.Delete(e.st.Watch, i, i+1)
		e.save()
		return false
	}
	e.st.Watch = append(e.st.Watch, code)
	e.save()
	return true
}

func (e *Engine) SetImages(on bool) {
	e.mu.Lock()
	e.st.Images = on
	e.save()
	e.mu.Unlock()
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// RefreshNow syncs the saved place and waits for it (the daily background job), then runs the AI
// delta. Returns "" or the error.
func (e *Engine) RefreshNow(timeoutSec int) string {
	e.Sync()
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		e.mu.RLock()
		busy, err := e.syncing, e.syncErr
		e.mu.RUnlock()
		if !busy {
			if err == "" {
				e.loadCatalog(false)
				e.autoAI()
			}
			return err
		}
		time.Sleep(time.Second)
	}
	e.CancelSync()
	return "timeout"
}
