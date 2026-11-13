package app

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/ai"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// MaxCheckRequests: deal checks per run (a city's flagged deals fit in about 10).
const MaxCheckRequests = 30

// SetAI saves the AI settings. The key stays in the app's private storage.
func (e *Engine) SetAI(c ai.Config) {
	e.mu.Lock()
	if c.DailyCap <= 0 {
		c.DailyCap = 300
	}
	e.st.AI = c
	e.save()
	e.mu.Unlock()
	if !c.On {
		e.StopAI()
	}
}

func (e *Engine) aiConfig() ai.Config {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.st.AI
}

// TestAI sends one small request: "" when it works, else the provider's error in Hebrew.
func (e *Engine) TestAI() string {
	c := e.aiConfig()
	c.On = true
	if !c.Usable() {
		return "חסרים מפתח, כתובת או שם מודל"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	text, err := e.cl.Chat(ctx, c, []ai.Message{{Role: "user", Content: `Answer with JSON only: {"ok":true}`}}, 1024, 35*time.Second)
	if err != nil {
		return err.Error()
	}
	if m := ai.ParseJSON(text); m == nil || string(m["ok"]) != "true" {
		return "המודל ענה, אבל לא בפורמט הנדרש"
	}
	return ""
}

// Models lists the provider's chat models.
func (e *Engine) Models() ([]string, error) {
	c := e.aiConfig()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	return e.cl.Models(ctx, c)
}

// autoAI runs after a sync and at start-up: the deal checks, then the classification delta.
func (e *Engine) autoAI() {
	c := e.aiConfig()
	if !c.Usable() {
		return
	}
	e.RunCheck()
	if c.EnrichAuto {
		e.RunEnrich()
	}
}

// StartAI is called when the app opens: background AI if it is set up.
func (e *Engine) StartAI() { go e.autoAI() }

func (e *Engine) startRun(kind string) (context.Context, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.aiStop != nil {
		return nil, false
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.aiStop = cancel
	e.aiRun = &aiStatus{Kind: kind, Live: true}
	return ctx, true
}

func (e *Engine) endRun(err string) {
	e.mu.Lock()
	if e.aiRun != nil {
		e.aiRun.Live, e.aiRun.Err, e.aiRun.At = false, err, time.Now().Unix()
	}
	e.aiStop = nil
	e.mu.Unlock()
	e.send(Event{Type: "ai", Msg: err})
}

func (e *Engine) progress(done, of, added int) {
	e.mu.Lock()
	if e.aiRun != nil {
		e.aiRun.Done, e.aiRun.Of, e.aiRun.Added = done, of, added
	}
	e.mu.Unlock()
	e.send(Event{Type: "ai", Done: done, Of: of})
}

// RunCheck asks the model about the "check at the till" deals that have no answer yet. Blocks.
func (e *Engine) RunCheck() {
	c := e.aiConfig()
	if !c.Usable() {
		return
	}
	deals := e.dealsNow()
	if len(deals) == 0 {
		return
	}
	ctx, ok := e.startRun("check")
	if !ok {
		return
	}
	asked, stop := e.verdicts.Check(ctx, e.cl, c, deals, MaxCheckRequests, func(done, of int) { e.progress(done, of, 0) })
	if asked > 0 {
		e.mu.Lock()
		e.deals = nil // rebuilt with the answers on next use
		e.mu.Unlock()
	}
	e.endRun(stop)
}

// items: every product of the catalog as classification input, most-sold first.
func (e *Engine) items() ([]ai.Item, []struct{ ID, Name string }) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.ix == nil {
		return nil, nil
	}
	ps := append([]*shop.Product(nil), e.ix.Products...)
	branches := func(p *shop.Product) int {
		n := 0
		for _, v := range p.Prices {
			if v >= 0 {
				n++
			}
		}
		return n
	}
	slices.SortStableFunc(ps, func(a, b *shop.Product) int { return branches(b) - branches(a) })
	var out []ai.Item
	for _, p := range ps {
		if strings.HasPrefix(p.Code, "f-") {
			continue
		}
		name := p.Name
		if p.RawName != "" {
			name = p.RawName
		}
		out = append(out, ai.Item{Code: p.Code, Name: name, Maker: p.Maker, Cat: p.Cat})
	}
	var cats []struct{ ID, Name string }
	for _, c := range e.ix.Cat.Categories {
		cats = append(cats, struct{ ID, Name string }{c.ID, c.Name})
	}
	return out, cats
}

// RunEnrich classifies the products without a record, within today's request cap. Blocks.
func (e *Engine) RunEnrich() {
	c := e.aiConfig()
	if !c.Usable() {
		return
	}
	items, cats := e.items()
	todo := e.store.Delta(items)
	left := e.requestsLeft()
	if len(todo) == 0 || left == 0 {
		return
	}
	ctx, ok := e.startRun("enrich")
	if !ok {
		return
	}
	stop := ai.Enrich(ctx, e.cl, c, e.store, todo, cats, left, func(done, of, added int) {
		e.countRequest()
		e.progress(done, of, added)
	})
	e.endRun(stop)
	// the run's records reach the screens once, at the end: one index rebuild, not one per batch
	e.loadCatalog(false)
}

func (e *Engine) requestsLeft() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	used := 0
	if e.st.Usage.Day == today() {
		used = e.st.Usage.N
	}
	return max(0, e.st.AI.DailyCap-used)
}

func (e *Engine) countRequest() {
	e.mu.Lock()
	if e.st.Usage.Day != today() {
		e.st.Usage = Usage{Day: today()}
	}
	e.st.Usage.N++
	e.save()
	e.mu.Unlock()
}

func today() string { return time.Now().Format("2006-01-02") }

// StopAI stops a running AI job.
func (e *Engine) StopAI() {
	e.mu.Lock()
	if e.aiStop != nil {
		e.aiStop()
	}
	e.mu.Unlock()
}

// ClearAI forgets every record and answer.
func (e *Engine) ClearAI() {
	e.StopAI()
	e.store.Clear()
	e.verdicts.Clear()
	e.mu.Lock()
	e.deals = nil
	e.mu.Unlock()
	go e.loadCatalog(false)
}
