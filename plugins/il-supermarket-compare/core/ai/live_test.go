package ai

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// SALZOL_AI_KEY=... SALZOL_CATALOG=catalog.json go test ./ai -run Live -v
// A real provider (Gemini by default): the connection test, one classification batch per model and
// one deal-check request, all through forced tool calls. Never runs without a key.
func TestLive(t *testing.T) {
	key, path := os.Getenv("SALZOL_AI_KEY"), os.Getenv("SALZOL_CATALOG")
	if key == "" || path == "" {
		t.Skip("set SALZOL_AI_KEY and SALZOL_CATALOG")
	}
	b, _ := os.ReadFile(path)
	var c core.Catalog
	json.Unmarshal(b, &c)
	ix, _ := shop.FromCatalog(&c, nil)
	cfg := DefaultConfig()
	cfg.On, cfg.Key = true, key
	ctx := context.Background()
	if _, err := DefaultClient.CallTool(ctx, cfg, []Message{{"user", "Call report_status with ok=true."}}, StatusTool, time.Minute); err != nil {
		t.Fatalf("status tool: %v", err)
	}
	var cats []struct{ ID, Name string }
	valid := map[string]bool{}
	for _, x := range c.Categories {
		cats = append(cats, struct{ ID, Name string }{x.ID, x.Name})
		valid[x.ID] = true
	}
	var items []Item
	for i, p := range ix.Products {
		if i%460 == 11 && len(items) < 80 {
			items = append(items, Item{Code: p.Code, Name: p.Name, Maker: p.Maker, Cat: p.Cat})
		}
	}
	for _, model := range []string{"gemini-flash-lite-latest", "gemini-4-hydrogen"} {
		m := cfg
		m.Model = model
		t0 := time.Now()
		args, err := DefaultClient.CallTool(ctx, m, EnrichPrompt(items, cats), EnrichTool(cats), 5*time.Minute)
		if err != nil {
			t.Errorf("%s: %v", model, err)
			continue
		}
		rows := ReadEnrich(items, args, valid, model, time.Now())
		t.Logf("%s: %d/%d records in %v; e.g. %s -> %+v", model, len(rows), len(items), time.Since(t0).Round(time.Second), items[0].Name, rows[0].Rec)
		if len(rows) < len(items)*9/10 {
			t.Errorf("%s: only %d of %d", model, len(rows), len(items))
		}
	}
	deals := ix.BuildDeals(func() []int {
		a := make([]int, len(c.Stores))
		for i := range a {
			a[i] = i
		}
		return a
	}(), nil, time.Now())
	v := OpenVerdicts(t.TempDir())
	t0 := time.Now()
	asked, stop := v.Check(ctx, DefaultClient, cfg, deals, 1, nil)
	t.Logf("deal check: %d answers in %v, stop=%q, %v", asked, time.Since(t0).Round(time.Second), stop, v.Stats())
	if asked == 0 || stop != "" {
		t.Errorf("deal check failed")
	}
}
