package app

import (
	"sort"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/ai"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// linkCandidateMax: pairs looked at per run of the duplicate search.
const linkCandidateMax = 400

// remapAliases moves cart, counters and watches from merged-away barcodes to the one they were merged
// into. Called with e.mu held, after a new index is built.
func (e *Engine) remapAliases(alias map[string]string) {
	if len(alias) == 0 {
		return
	}
	changed := false
	for s, p := range alias {
		if q, ok := e.st.Cart[s]; ok {
			e.st.Cart[p] += q
			delete(e.st.Cart, s)
			changed = true
		}
		if n, ok := e.st.Freq[s]; ok {
			e.st.Freq[p] += n
			delete(e.st.Freq, s)
			changed = true
		}
		for i, w := range e.st.Watch {
			if w == s {
				e.st.Watch[i] = p
				changed = true
			}
		}
	}
	for i := range e.st.Lists {
		for s, p := range alias {
			if q, ok := e.st.Lists[i].Items[s]; ok {
				e.st.Lists[i].Items[p] += q
				delete(e.st.Lists[i].Items, s)
				changed = true
			}
		}
	}
	// a watch list that now holds the same product twice
	seen := map[string]bool{}
	out := e.st.Watch[:0]
	for _, w := range e.st.Watch {
		if !seen[w] {
			seen[w] = true
			out = append(out, w)
		}
	}
	e.st.Watch = out
	if changed {
		e.save()
	}
}

// ReviewRow is one change the model made to the catalog, for the user to keep or undo.
type ReviewRow struct {
	Kind   string `json:"kind"` // "name", "link"
	Key    string `json:"key"`  // the code the decision is about
	Title  string `json:"title"`
	Before string `json:"before"` // the name as in the price file / the other barcode's name
	Active bool   `json:"active"` // applied now
	Wait   bool   `json:"wait"`   // a link that waits for approval
}

// CatalogView is the catalog-tools screen.
type CatalogView struct {
	NameTodo   int         `json:"nameTodo"` // messy names not asked about yet
	LinkTodo   int         `json:"linkTodo"` // possible duplicates not asked about yet
	Names      int         `json:"names"`    // names cleaned
	Links      int         `json:"links"`    // products merged
	Waiting    int         `json:"waiting"`  // links waiting for approval
	AutoLink   bool        `json:"autoLink"`
	Rows       []ReviewRow `json:"rows"`
	Run        *aiStatus   `json:"run,omitempty"`
	HasAI      bool        `json:"hasAI"`
	RequestsOK int         `json:"requestsLeft"`
}

// Catalog builds the catalog-tools screen.
func (e *Engine) Catalog() CatalogView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	cur := e.st.Cur
	v := CatalogView{AutoLink: cur.AutoLink, Run: e.aiRun, HasAI: e.st.AI.Usable(), Rows: []ReviewRow{}}
	used := 0
	if e.st.Usage.Day == today() {
		used = e.st.Usage.N
	}
	v.RequestsOK = max(0, e.st.AI.DailyCap-used)
	if e.ix == nil {
		return v
	}
	v.NameTodo = len(e.ix.NameCandidates(cur))
	v.LinkTodo = len(e.ix.LinkCandidates(cur, linkCandidateMax))
	for code, name := range cur.Names {
		p := e.ix.ByCode[code]
		if p == nil {
			continue
		}
		on := !cur.Rejected["names:"+code]
		before := p.RawName
		if !on {
			before = p.Name
		}
		if on {
			v.Names++
		}
		v.Rows = append(v.Rows, ReviewRow{Kind: "name", Key: code, Title: name, Before: before, Active: on})
	}
	for s, pc := range cur.Links {
		primary := e.ix.ByCode[pc]
		if primary == nil {
			continue
		}
		on := cur.LinkActive(s)
		wait := !on && !cur.Rejected["links:"+s]
		row := ReviewRow{Kind: "link", Key: s, Title: primary.Name, Active: on, Wait: wait}
		if a := e.ix.ByCode[s]; a != nil {
			row.Before = a.Name
		} else {
			row.Before = s // merged away: only its barcode is left
		}
		if on {
			v.Links++
		}
		if wait {
			v.Waiting++
		}
		v.Rows = append(v.Rows, row)
	}
	sort.SliceStable(v.Rows, func(i, j int) bool {
		a, b := v.Rows[i], v.Rows[j]
		if a.Wait != b.Wait {
			return a.Wait
		}
		if a.Kind != b.Kind {
			return a.Kind > b.Kind
		}
		return a.Key < b.Key
	})
	return v
}

// curApply changes the curation under the lock and rebuilds the index so the screens show it.
func (e *Engine) curApply(f func(c *shop.Curation)) {
	e.mu.Lock()
	f(e.st.Cur)
	e.save()
	e.mu.Unlock()
	e.loadCatalog(false)
}

// RunNames asks the model to clean the messy names. Blocks.
func (e *Engine) RunNames() { e.runCurate("names") }

// RunLinks asks the model about the possible duplicates. Blocks.
func (e *Engine) RunLinks() { e.runCurate("links") }

func (e *Engine) runCurate(kind string) {
	c := e.aiConfig()
	if !c.Usable() {
		return
	}
	e.mu.RLock()
	ix, cur := e.ix, e.st.Cur.Clone()
	e.mu.RUnlock()
	if ix == nil {
		return
	}
	left := e.requestsLeft()
	if left == 0 {
		return
	}
	var names []*shop.Product
	var pairs []shop.LinkPair
	if kind == "names" {
		names = ix.NameCandidates(cur)
	} else {
		pairs = ix.LinkCandidates(cur, linkCandidateMax)
	}
	if len(names)+len(pairs) == 0 {
		return
	}
	ctx, ok := e.startRun(kind)
	if !ok {
		return
	}
	// every answer is written into the saved curation under the lock, one batch at a time
	e.mu.RLock()
	live := e.st.Cur
	e.mu.RUnlock()
	wrap := func(g func()) {
		e.mu.Lock()
		g()
		e.save()
		e.mu.Unlock()
	}
	prog := func(done, of, added int) {
		e.countRequest()
		e.progress(done, of, added)
	}
	var stop string
	if kind == "names" {
		stop = ai.CleanNames(ctx, e.cl, c, names, live, left, wrap, prog)
	} else {
		stop = ai.FindLinks(ctx, e.cl, c, pairs, live, left, wrap, prog)
	}
	e.endRun(stop)
	e.loadCatalog(false)
}

// SetAutoLink: merge the model's duplicate answers without waiting for approval.
func (e *Engine) SetAutoLink(on bool) { e.curApply(func(c *shop.Curation) { c.AutoLink = on }) }

// ReviewLink approves or undoes a merge (decision "approve" or "reject").
func (e *Engine) ReviewLink(secondary, decision string) {
	e.curApply(func(c *shop.Curation) {
		switch decision {
		case "approve":
			c.Approved[secondary] = true
			delete(c.Rejected, "links:"+secondary)
		case "reject":
			delete(c.Approved, secondary)
			c.Rejected["links:"+secondary] = true
		}
	})
}

// ApproveAllLinks approves every merge that is waiting.
func (e *Engine) ApproveAllLinks() {
	e.curApply(func(c *shop.Curation) {
		for s := range c.Links {
			if !c.Rejected["links:"+s] {
				c.Approved[s] = true
			}
		}
	})
}

// ReviewName keeps or undoes a cleaned name (decision "keep" or "undo").
func (e *Engine) ReviewName(code, decision string) {
	e.curApply(func(c *shop.Curation) {
		if decision == "undo" {
			c.Rejected["names:"+code] = true
		} else {
			delete(c.Rejected, "names:"+code)
		}
	})
}

// ClearCuration forgets every cleaned name and merge.
func (e *Engine) ClearCuration() {
	e.StopAI()
	e.curApply(func(c *shop.Curation) { *c = *shop.NewCuration() })
}
