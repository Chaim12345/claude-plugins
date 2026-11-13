package core

// Fixture tests for the portals that refuse non-Israeli IPs (Victory, Carrefour/Yayno Bitan, Hazi
// Hinam, Mahsanei HaShuk, H. Cohen, Quik). They can't be reached from outside Israel, so the
// clients are checked against httptest servers that mimic the listings the original scraper
// (scrappers/victory.py, engines/publishprice.py, scrappers/hazihinam.py) parses.

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func gz(s string) []byte {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	w.Write([]byte(s))
	w.Close()
	return b.Bytes()
}

func storesXML(rows ...[4]string) string { // id, name, address, city
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?><Root><SubChains><SubChain><Stores>`)
	for _, r := range rows {
		fmt.Fprintf(&sb, "<Store><StoreId>%s</StoreId><StoreName>%s</StoreName><Address>%s</Address><City>%s</City></Store>", r[0], r[1], r[2], r[3])
	}
	sb.WriteString(`</Stores></SubChain></SubChains></Root>`)
	return sb.String()
}

func priceXML(items ...[3]string) string { // code, name, price
	var sb strings.Builder
	sb.WriteString(`<Root><Items>`)
	for _, i := range items {
		fmt.Fprintf(&sb, "<Item><ItemCode>%s</ItemCode><ItemName>%s</ItemName><ItemPrice>%s</ItemPrice></Item>", i[0], i[1], i[2])
	}
	sb.WriteString(`</Items></Root>`)
	return sb.String()
}

var testStores = storesXML(
	[4]string{"001", "ויקטורי רמת גן", "ז'בוטינסקי 10", "רמת גן"},
	[4]string{"012", "ויקטורי גבעתיים", "כצנלסון 5", "גבעתיים"},
)

func checkPortal(t *testing.T, p Portal, wantStores int, storeID, wantFile, wantItem string) {
	t.Helper()
	ctx := context.Background()
	rows, err := p.Stores(ctx)
	if err != nil {
		t.Fatalf("Stores: %v", err)
	}
	if len(rows) != wantStores || rows[0].Name == "" || rows[0].Address == "" {
		t.Fatalf("Stores = %+v, want %d rows with names and addresses", rows, wantStores)
	}
	f, err := p.LatestPriceFull(ctx, storeID)
	if err != nil {
		t.Fatalf("LatestPriceFull: %v", err)
	}
	if f.Name != wantFile {
		t.Fatalf("LatestPriceFull(%s) = %q, want %q", storeID, f.Name, wantFile)
	}
	rc, err := p.Open(ctx, f)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer rc.Close()
	items, err := ParsePriceFile(rc)
	if err != nil || len(items) != 1 || items[0].Name != wantItem {
		t.Fatalf("items = %+v, err %v, want one %q", items, err, wantItem)
	}
	if _, err := p.LatestPriceFull(ctx, "999"); err == nil {
		t.Errorf("a store without a PriceFull should not resolve")
	} else if _, ok := err.(ErrNotPublished); !ok {
		t.Errorf("want ErrNotPublished, got %v", err)
	}
}

func TestLaibcatalog(t *testing.T) {
	const edi = "7290696200003"
	var hits []string
	mux := http.NewServeMux()
	mux.HandleFunc("/webapi/api/getfiles", func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.URL.RawQuery)
		if r.URL.Query().Get("edi") != edi { // the second sub-chain has no branches
			http.Error(w, "FilesRootPath is invalid", 400)
			return
		}
		json.NewEncoder(w).Encode([]map[string]string{
			{"fileName": "Stores7290696200003-000-202611110600.xml.gz", "fileType": "storesfull"},
			{"fileName": "Stores7290696200003-000-202611120600.xml.gz", "fileType": "storesfull"},
			{"fileName": "PriceFull7290696200003-001-202611110600.xml.gz", "fileType": "pricefull"},
			{"fileName": "PriceFull7290696200003-001-202611120600.xml.gz", "fileType": "pricefull"},
			{"fileName": "Price7290696200003-001-202611120700.xml.gz", "fileType": "price"},
			{"fileName": "PromoFull7290696200003-001-202611120600.xml.gz", "fileType": "promofull"},
		})
	})
	mux.HandleFunc("/webapi/"+edi+"/", func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
		switch {
		case strings.HasPrefix(name, "Stores"):
			w.Write(gz(testStores))
		case strings.HasSuffix(name, "202611120600.xml.gz"):
			w.Write(gz(priceXML([3]string{"7290000000001", "חלב 3% 1 ליטר", "6.5"})))
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	old := laibURL
	laibURL = srv.URL
	defer func() { laibURL = old }()

	p, err := NewPortal("victory", srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	checkPortal(t, p, 2, "1", "PriceFull7290696200003-001-202611120600.xml.gz", "חלב 3% 1 ליטר")
	if len(hits) != 2 { // one listing per sub-chain, cached for the later calls
		t.Errorf("listing requests = %v, want one per sub-chain", hits)
	}
	// Mahsanei HaShuk and H. Cohen use other chain IDs; with none published, the clients report it.
	for _, c := range []string{"mahsanei", "hcohen"} {
		p, _ := NewPortal(c, srv.Client())
		if _, err := p.Stores(context.Background()); err == nil {
			t.Errorf("%s: want an error when the listing is refused", c)
		}
	}
}

func pubPage(path string, files []string) string {
	var fs []map[string]any
	for _, f := range files {
		fs = append(fs, map[string]any{"name": f, "size": 1234, "modified": "06:00 12-11-2026"})
	}
	b, _ := json.Marshal(fs)
	return `<html><body><script>var x = 1;</script><script>
const path = '` + path + `';
const files = ` + string(b) + `;
const chains = [{"name":"Decoy.xml.gz"},{"name":"PriceFull-Decoy-001-202611120600.gz"}];
</script><script>init()</script></body></html>`
}

func TestPublishPrice(t *testing.T) {
	for _, c := range []struct {
		chain string
		set   func(string) func()
	}{
		{"carrefour", func(u string) func() { o := carrefourURL; carrefourURL = u; return func() { carrefourURL = o } }},
		{"quik", func(u string) func() { o := quikURL; quikURL = u; return func() { quikURL = o } }},
	} {
		t.Run(c.chain, func(t *testing.T) {
			files := []string{
				"Stores7290055700007-000-202611120600.gz",
				"PriceFull7290055700007-005-202611120300.gz",
				"PriceFull7290055700007-005-202611120600.gz",
				"PriceFull7290055700007-006-202611120600.gz",
				"Promo7290055700007-005-202611120600.gz",
			}
			mux := http.NewServeMux()
			mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/" {
					http.NotFound(w, r)
					return
				}
				w.Write([]byte(pubPage("20261112", files)))
			})
			mux.HandleFunc("/20261112/", func(w http.ResponseWriter, r *http.Request) {
				name := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
				switch name {
				case files[0]:
					w.Write(gz(testStores))
				case files[2]:
					w.Write(gz(priceXML([3]string{"1", "במבה 80 גרם", "4.9"})))
				default:
					http.NotFound(w, r)
				}
			})
			srv := httptest.NewServer(mux)
			defer srv.Close()
			defer c.set(srv.URL)()
			p, err := NewPortal(c.chain, srv.Client())
			if err != nil {
				t.Fatal(err)
			}
			checkPortal(t, p, 2, "5", files[2], "במבה 80 גרם")
			// The chain list after the files array must not leak into the listing.
			idx, _ := p.(*publishPrice).index(context.Background())
			for _, f := range idx {
				if strings.Contains(f.Name, "Decoy") {
					t.Errorf("listing includes %q from the chains array", f.Name)
				}
			}
		})
	}
}

func TestPublishPriceIndexChanged(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>nothing</html>")) }))
	defer srv.Close()
	p := &publishPrice{c: srv.Client(), chain: "quik", base: srv.URL}
	if _, err := p.Stores(context.Background()); err == nil || !strings.Contains(err.Error(), "index format changed") {
		t.Errorf("err = %v", err)
	}
}

func haziRow(date, name, size, href string) string {
	return fmt.Sprintf(`<tr><td>%s</td><td>חצי חינם</td><td>%s</td><td>1</td><td>%s</td><td><a href="%s">הורדה</a></td></tr>`, date, name, size, href)
}

func TestHaziHinam(t *testing.T) {
	yesterday := haziDays()[1]
	var queries []string
	mux := http.NewServeMux()
	mux.HandleFunc("/Prices", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		queries = append(queries, r.URL.RawQuery)
		// Files exist only under yesterday's date, so the client must fall back to it.
		var rows []string
		if q.Get("d") == yesterday && q.Get("f") == "null" {
			switch q.Get("t") + "/" + q.Get("p") {
			case "3/1":
				rows = []string{haziRow("11-11-2026 06:00", "Stores7290700100008-000-202611110600", "5", "/dl/stores-old.xml.gz"),
					haziRow("12-11-2026 06:00", "Stores7290700100008-000-202611120600", "5", "/dl/stores.xml.gz?token=a&amp;b=c")}
			case "1/1":
				rows = []string{haziRow("12-11-2026 06:00", "PriceFull7290700100008-004-202611120300", "50", "/dl/p-old.xml.gz"),
					haziRow("12-11-2026 06:00", "Price7290700100008-004-202611120700", "50", "/dl/price.xml.gz")}
			case "1/2":
				rows = []string{haziRow("12-11-2026 06:00", "PriceFull7290700100008-004-202611120600", "50", "/dl/p-new.xml.gz")}
			case "1/3": // a page past the end repeats the last one
				rows = []string{haziRow("12-11-2026 06:00", "PriceFull7290700100008-004-202611120600", "50", "/dl/p-new.xml.gz")}
			}
		}
		fmt.Fprintf(w, `<html><table><thead><tr><th>a</th></tr></thead><tbody>%s</tbody></table></html>`, strings.Join(rows, ""))
	})
	mux.HandleFunc("/dl/", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/dl/stores.xml.gz":
			if r.URL.Query().Get("token") != "a" || r.URL.Query().Get("b") != "c" {
				http.Error(w, "bad link", 400)
				return
			}
			w.Write(gz(storesXML([4]string{"001", "חצי חינם אשדוד", "הנחשול 1", "אשדוד"}, [4]string{"004", "חצי חינם אשקלון", "הברוש 2", "אשקלון"})))
		case "/dl/p-new.xml.gz":
			w.Write(gz(priceXML([3]string{"1", "שמן זית", "29.9"})))
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	old := haziURL
	haziURL = srv.URL + "/Prices"
	defer func() { haziURL = old }()

	p, err := NewPortal("hazihinam", srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	// The name column has no extension; the client appends ".xml.gz" like the original.
	checkPortal(t, p, 2, "4", "PriceFull7290700100008-004-202611120600.xml.gz", "שמן זית")
	var sawStores, sawPrice, sawPaged bool
	for _, q := range queries {
		sawStores = sawStores || strings.Contains(q, "t=3")
		sawPrice = sawPrice || strings.Contains(q, "t=1")
		sawPaged = sawPaged || strings.Contains(q, "p=2")
	}
	if !sawStores || !sawPrice || !sawPaged {
		t.Errorf("queries %v: want t=3 (Stores), t=1 (prices) and paging", queries)
	}
}

// ---------------- discovery ----------------

// blockedFixture serves Victory (laibcatalog) and Carrefour (publishprice) fixtures; every other
// discoverable chain answers with an error, as an unreachable portal would.
func blockedFixture(t *testing.T) (restore func()) {
	t.Helper()
	const edi = "7290696200003"
	lmux := http.NewServeMux()
	lmux.HandleFunc("/webapi/api/getfiles", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("edi") != edi {
			http.Error(w, "no", 400)
			return
		}
		json.NewEncoder(w).Encode([]map[string]string{{"fileName": "Stores7290696200003-000-202611120600.xml.gz"}})
	})
	lmux.HandleFunc("/webapi/"+edi+"/", func(w http.ResponseWriter, r *http.Request) {
		w.Write(gz(testStores))
	})
	laib := httptest.NewServer(lmux)

	cmux := http.NewServeMux()
	cmux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(pubPage("20261112", []string{"Stores7290055700007-000-202611120600.gz"})))
	})
	cmux.HandleFunc("/20261112/", func(w http.ResponseWriter, r *http.Request) {
		w.Write(gz(storesXML([4]string{"003", "קרפור סיטי רמת גן", "ביאליק 2", "רמת גן"})))
	})
	car := httptest.NewServer(cmux)

	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "geo-blocked", 403) }))
	cities := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"result":{"records":[{"סמל_ישוב":"8600","שם_ישוב":"רמת גן"},{"סמל_ישוב":"6300","שם_ישוב":"גבעתיים"}]}}`))
	}))
	oL, oC, oQ, oH, oN := laibURL, carrefourURL, quikURL, haziURL, cityNamesURL
	laibURL, carrefourURL, quikURL, haziURL, cityNamesURL = laib.URL, car.URL, dead.URL, dead.URL, cities.URL
	return func() {
		laibURL, carrefourURL, quikURL, haziURL, cityNamesURL = oL, oC, oQ, oH, oN
		laib.Close()
		car.Close()
		dead.Close()
		cities.Close()
	}
}

func TestDiscoverableChains(t *testing.T) {
	got := map[string]bool{}
	for _, c := range DiscoverableChains() {
		got[c] = true
	}
	for _, c := range []string{"victory", "carrefour", "hazihinam", "mahsanei", "hcohen"} {
		if !got[c] {
			t.Errorf("%s should be discoverable (absent from the embedded directory)", c)
		}
	}
	for _, c := range []string{"shufersal", "RamiLevi", "supersapir"} {
		if got[c] {
			t.Errorf("%s is already in the embedded directory", c)
		}
	}
}

func TestDiscoverStores(t *testing.T) {
	defer blockedFixture(t)()
	var events []Event
	d, err := DiscoverStores(context.Background(), []string{"victory", "carrefour", "hazihinam"}, NewGeocoder(""), nil, func(e Event) { events = append(events, e) })
	if err != nil {
		t.Fatal(err)
	}
	by := map[string][]DirStore{}
	for _, s := range d.Stores {
		by[s.Chain] = append(by[s.Chain], s)
	}
	if len(by["victory"]) != 2 || len(by["carrefour"]) != 1 || len(by["hazihinam"]) != 0 {
		t.Fatalf("stores by chain: %v", by)
	}
	for _, s := range d.Stores {
		if s.Lat == 0 || s.Lon == 0 {
			t.Errorf("%s was not placed", s.Key())
		}
		if s.Banner == "" || s.City == "" {
			t.Errorf("%s lacks banner or city: %+v", s.Key(), s)
		}
	}
	if by["carrefour"][0].Banner != "קרפור סיטי" || by["victory"][0].Banner != "ויקטורי" {
		t.Errorf("banners: %+v %+v", by["carrefour"][0], by["victory"][0])
	}
	var skipped bool
	for _, e := range events {
		skipped = skipped || (e.Phase == "skip" && e.Store == "hazihinam")
	}
	if !skipped {
		t.Errorf("no skip event for the failing chain: %v", events)
	}
	// Every chain failing is an error.
	if _, err := DiscoverStores(context.Background(), []string{"hazihinam", "quik"}, NewGeocoder(""), nil, nil); err == nil {
		t.Errorf("want an error when every chain fails")
	}
}

func TestChainsDue(t *testing.T) {
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	ts := func(d time.Duration) string { return now.Add(-d).Format(time.RFC3339) }
	cands := []string{"hazihinam", "victory"}
	withVictory := &Directory{Stores: []DirStore{{Chain: "victory", StoreID: "1"}}}
	none := &Directory{}
	cases := []struct {
		name   string
		merged *Directory
		e      *extraFile
		want   string
	}{
		{"nothing known: all due", none, &extraFile{}, "hazihinam,victory"},
		{"fresh file, only the empty chain is due", withVictory, &extraFile{Built: ts(time.Hour)}, "hazihinam"},
		{"file older than 7 days: all due", withVictory, &extraFile{Built: ts(8 * 24 * time.Hour)}, "hazihinam,victory"},
		{"6 days old is still fresh", withVictory, &extraFile{Built: ts(6 * 24 * time.Hour)}, "hazihinam"},
		{"recently tried chains wait", withVictory, &extraFile{Built: ts(8 * 24 * time.Hour), Tried: map[string]string{"hazihinam": ts(time.Hour)}}, "victory"},
		{"retry after the backoff", none, &extraFile{Built: ts(time.Hour), Tried: map[string]string{"hazihinam": ts(7 * time.Hour)}}, "hazihinam,victory"},
		{"all known and fresh: nothing", &Directory{Stores: []DirStore{{Chain: "victory"}, {Chain: "hazihinam"}}}, &extraFile{Built: ts(time.Hour)}, ""},
	}
	for _, c := range cases {
		if got := strings.Join(chainsDue(cands, c.merged, c.e, now), ","); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestLoadDirectoryMerge(t *testing.T) {
	base, _ := DefaultDirectory()
	dir := t.TempDir()
	if d, err := LoadDirectory(dir); err != nil || len(d.Stores) != len(base.Stores) {
		t.Fatalf("no extra file: %d stores, err %v; want the embedded %d", len(d.Stores), err, len(base.Stores))
	}
	clash := base.Stores[0]
	clash.Name = "OVERRIDDEN"
	extra := extraFile{Built: time.Now().Format(time.RFC3339), Stores: []DirStore{clash, {Chain: "victory", StoreID: "7", Banner: "ויקטורי", Lat: 32.08, Lon: 34.81}}}
	b, _ := json.Marshal(extra)
	os.WriteFile(filepath.Join(dir, ExtraFile), b, 0o644)
	d, err := LoadDirectory(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Stores) != len(base.Stores)+1 {
		t.Errorf("merged = %d stores, want %d (one override, one addition)", len(d.Stores), len(base.Stores)+1)
	}
	n := 0
	for _, s := range d.Stores {
		if s.Key() == clash.Key() {
			n++
			if s.Name != "OVERRIDDEN" {
				t.Errorf("the extra entry should win on the same key")
			}
		}
	}
	if n != 1 {
		t.Errorf("key %s appears %d times", clash.Key(), n)
	}
	// A damaged file is ignored.
	os.WriteFile(filepath.Join(dir, ExtraFile), []byte("{not json"), 0o644)
	if d, err := LoadDirectory(dir); err != nil || len(d.Stores) != len(base.Stores) {
		t.Errorf("damaged extra: %d stores, err %v", len(d.Stores), err)
	}
}

func TestRefreshExtra(t *testing.T) {
	defer blockedFixture(t)()
	dir := t.TempDir()
	ctx := context.Background()
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	var first Event
	sum, err := RefreshExtra(ctx, dir, NewGeocoder(""), nil, func(e Event) {
		if first.Phase == "" {
			first = e
		}
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Counts["victory"] != 2 || sum.Counts["carrefour"] != 1 {
		t.Errorf("counts = %v", sum.Counts)
	}
	for _, c := range []string{"hazihinam", "mahsanei", "hcohen"} {
		if sum.Errors[c] == "" {
			t.Errorf("%s: want an error, got summary %+v", c, sum)
		}
	}
	if first.Phase != "discover" || !strings.Contains(first.Message, "ויקטורי") || !strings.Contains(first.Message, "קרפור") {
		t.Errorf("first event = %+v, want a discover event naming the chains", first)
	}

	d, err := LoadDirectory(dir)
	if err != nil {
		t.Fatal(err)
	}
	var victory int
	for _, s := range d.Stores {
		if s.Chain == "victory" {
			victory++
		}
	}
	if victory != 2 {
		t.Errorf("merged directory has %d Victory branches, want 2", victory)
	}
	// The merged directory feeds Nearby: Ramat Gan now has a Victory branch.
	var found bool
	for _, n := range d.Nearby(32.0684, 34.8248, 3, 30) {
		found = found || n.Chain == "victory"
	}
	if !found {
		t.Errorf("Nearby ignores discovered stores")
	}

	// A minute later nothing is due: Victory and Carrefour are known, the rest were just tried.
	sum, err = RefreshExtra(ctx, dir, NewGeocoder(""), nil, nil, now.Add(time.Minute))
	if err != nil || !sum.Skipped {
		t.Errorf("second run = %+v, %v; want skipped", sum, err)
	}
	// After 8 days the file is stale, so everything is asked again.
	sum, err = RefreshExtra(ctx, dir, NewGeocoder(""), nil, nil, now.Add(8*24*time.Hour))
	if err != nil || sum.Skipped || sum.Counts["victory"] != 2 {
		t.Errorf("stale run = %+v, %v", sum, err)
	}
	// A chain that fails on refresh keeps the branches found before.
	laibURL = "http://127.0.0.1:1"
	sum, _ = RefreshExtra(ctx, dir, NewGeocoder(""), nil, nil, now.Add(20*24*time.Hour))
	if sum.Errors["victory"] == "" {
		t.Errorf("want a victory error: %+v", sum)
	}
	d, _ = LoadDirectory(dir)
	victory = 0
	for _, s := range d.Stores {
		if s.Chain == "victory" {
			victory++
		}
	}
	if victory != 2 {
		t.Errorf("a failed refresh lost the stored branches: %d", victory)
	}
}

func TestNetivHesedPortal(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	page := `<table><tr><th>סניף</th><th>קובץ</th></tr>
<tr><td>1</td><td>Stores</td><td></td><td></td><td>13/11/2026 05:00</td><td><a href="/Download?fileName=Stores7290058160839-000-202611130500.xml.gz">הורדה</a></td></tr>
<tr><td>3</td><td>PriceFull</td><td></td><td></td><td>13/11/2026 05:00</td><td><a href="/Download?fileName=PriceFull7290058160839-001-003-20261113-050000.xml.gz">הורדה</a></td></tr>
<tr><td>3</td><td>Price</td><td></td><td></td><td>13/11/2026 06:00</td><td><a href="/Download?fileName=Price7290058160839-001-003-20261113-060000.xml.gz">הורדה</a></td></tr>
<tr><td>3</td><td>PromoFull</td><td></td><td></td><td>13/11/2026 05:00</td><td><a href="/Download?fileName=PromoFull7290058160839-001-003-20261113-050000.xml.gz">הורדה</a></td></tr>
</table>`
	stores := `<Root><Stores><Store><StoreId>3</StoreId><StoreName>נתיב החסד בני ברק</StoreName><Address>רבי עקיבא 100</Address><City>בני ברק</City></Store></Stores></Root>`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/" && r.URL.Query().Get("Date") == today:
			fmt.Fprint(w, page)
		case r.URL.Path == "/":
			fmt.Fprint(w, "<table></table>")
		case strings.HasPrefix(r.URL.Query().Get("fileName"), "Stores"):
			fmt.Fprint(w, stores)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	old := netivURL
	netivURL = srv.URL + "/"
	defer func() { netivURL = old }()

	p, ok := newExtraPortal("netivhased", srv.Client())
	if !ok {
		t.Fatal("no netivhased portal")
	}
	ctx := context.Background()
	f, err := p.LatestPriceFull(ctx, "3")
	if err != nil || f.Name != "PriceFull7290058160839-001-003-20261113-050000.xml.gz" || !strings.HasPrefix(f.URL, srv.URL+"/Download?fileName=") {
		t.Fatalf("price full = %+v, %v", f, err)
	}
	if f, err := p.LatestPromoFull(ctx, "3"); err != nil || !strings.HasPrefix(f.Name, "PromoFull") {
		t.Errorf("promo full = %+v, %v", f, err)
	}
	if _, err := p.LatestPriceFull(ctx, "9"); err == nil {
		t.Error("a store with no file should be ErrNotPublished")
	}
	rows, err := p.Stores(ctx)
	if err != nil || len(rows) != 1 || rows[0].City != "בני ברק" || rows[0].Chain != "netivhased" {
		t.Errorf("stores = %+v, %v", rows, err)
	}
	for _, c := range DiscoverableChains() {
		if c == "quik" || c == "SuperCofixApp" {
			t.Errorf("retired chain %s is still discovered", c)
		}
	}
}
