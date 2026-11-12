package core

// Portal clients for chains that publish outside Shufersal's site and publishedprices.co.il.
//
// Derived from israeli-supermarket-scarpers by Sefi Erlich
// (https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers), used under its
// non-commercial license. Changes: rewritten in Go; one store's newest PriceFull and PromoFull
// and the chain's Stores file only (no history); download URLs and chain IDs taken from the
// original, listing and parsing reimplemented. Commercial use needs the original author's written
// permission. See THIRD_PARTY.md.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// ChainNames maps every portal key to the name people know the chain by.
var ChainNames = map[string]string{
	"shufersal": "שופרסל", "carrefour": "קרפור", "quik": "קוויק",
	"victory": "ויקטורי", "mahsanei": "מחסני השוק", "hcohen": "ח. כהן",
	"wolt": "וולט מרקט", "hazihinam": "חצי חינם",
	"bareket": "סופר ברקת", "kingstore": "קינג סטור", "maayan2000": "מעיין 2000", "zolvebegadol": "זול ובגדול",
	"supersapir": "סופר ספיר", "shukhair": "שוק העיר", "shefa": "שפע ברכת השם", "citymarket": "סיטי מרקט",
	"ktmarket": "קיי.טי מרקט (משנת יוסף)", "netivhased": "נתיב החסד",
}

func init() {
	for k, v := range PublishedPricesUsers {
		ChainNames[k] = v
	}
}

// ExtraChains are the portal keys added in this file, for the directory builder.
var ExtraChains = []string{"quik", "victory", "mahsanei", "hcohen", "wolt", "hazihinam",
	"bareket", "kingstore", "maayan2000", "zolvebegadol", "supersapir", "shukhair", "shefa", "citymarket",
	"ktmarket", "netivhased"}

// Portal base URLs. They are variables so tests can point the clients at httptest servers.
var (
	quikURL = "https://prices.quik.co.il"
	laibURL = "https://laibcatalog.co.il"
)

// hasPrefixFold reports whether a published file name starts with a file-type prefix, ignoring case.
func hasPrefixFold(name, prefix string) bool {
	return len(name) >= len(prefix) && strings.EqualFold(name[:len(prefix)], prefix)
}

func newExtraPortal(chain string, c *http.Client) (Portal, bool) {
	jar := func() *http.Client {
		j, _ := cookiejar.New(nil)
		cc := *c
		cc.Jar = j
		return &cc
	}
	switch chain {
	case "quik":
		return &publishPrice{c: c, chain: chain, base: quikURL}, true
	case "victory":
		return &laibcatalog{c: c, chain: chain, edis: []string{"7290696200003", "7290058103393"}}, true
	case "mahsanei":
		return &laibcatalog{c: c, chain: chain, edis: []string{"7290661400001", "7290633800006"}}, true
	case "hcohen":
		return &laibcatalog{c: c, chain: chain, edis: []string{"7290455000004"}}, true
	case "wolt":
		return &wolt{c: c}, true
	case "hazihinam":
		return &haziHinam{c: c}, true
	}
	if b, ok := binaChains[chain]; ok {
		return &bina{c: jar(), chain: chain, prefix: b.prefix, chainIDs: b.ids}, true
	}
	return nil, false
}

// ---------------- Bina projects (binaprojects.com) ----------------

var binaChains = map[string]struct {
	prefix string
	ids    []string
}{
	"bareket":      {"superbareket", []string{"7290875100001"}},
	"kingstore":    {"kingstore", []string{"7290058108879"}},
	"maayan2000":   {"maayan2000", []string{"7290058159628"}},
	"zolvebegadol": {"zolvebegadol", []string{"7290058173198"}},
	"supersapir":   {"supersapir", []string{"7290058156016"}},
	"shukhair":     {"shuk-hayir", []string{"7290058148776"}},
	"shefa":        {"shefabirkathashem", []string{"7290058134977"}},
	"citymarket":   {"citymarketkiryatgat", []string{"7290058288526", "7290058266241", "7290058288090"}},
	// City Market's two other Bina portals (citymarketgivatayim, citymarketkiryatono) stopped
	// publishing in 2024; their branches are in the portal above.
	"ktmarket":   {"ktshivuk", []string{"7290058289400"}},
	"netivhased": {"netivhased", []string{"7290058160839"}},
}

type bina struct {
	c        *http.Client
	chain    string
	prefix   string
	chainIDs []string
	warm     bool
}

func (b *bina) base() string { return "https://" + b.prefix + ".binaprojects.com" }

// list returns the portal's files of one type (1 Stores, 4 PriceFull), optionally for one store.
func (b *bina) list(ctx context.Context, fileType, store string) ([]FileRef, error) {
	if !b.warm { // the listing needs the session cookie from the main page
		if r, err := get(ctx, b.c, b.base()+"/Main.aspx"); err == nil {
			r.Body.Close()
		}
		b.warm = true
	}
	var out []FileRef
	for _, id := range b.chainIDs {
		q := url.Values{"_": {id}, "wReshet": {"הכל"}, "WFileType": {fileType}, "WDate": {""}, "WStore": {store}}
		resp, err := get(ctx, b.c, b.base()+"/MainIO_Hok.aspx?"+q.Encode())
		if err != nil {
			return nil, err
		}
		var rows []struct {
			FileNm string `json:"FileNm"`
		}
		err = json.NewDecoder(resp.Body).Decode(&rows)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("%s listing: %w", b.chain, err)
		}
		for _, r := range rows {
			out = append(out, FileRef{Name: r.FileNm, URL: b.base() + "/Download.aspx?FileNm=" + url.QueryEscape(r.FileNm)})
		}
	}
	return out, nil
}

func (b *bina) Stores(ctx context.Context) ([]StoreRow, error) {
	l, err := b.list(ctx, "1", "")
	if err != nil {
		return nil, err
	}
	if len(l) == 0 {
		return nil, fmt.Errorf("%s: no Stores file", b.chain)
	}
	rc, err := b.Open(ctx, newest(l))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return ParseStoresFile(rc, b.chain)
}

func (b *bina) LatestPriceFull(ctx context.Context, storeID string) (FileRef, error) {
	return b.latest(ctx, "4", "PriceFull", storeID)
}

// LatestPromoFull: Bina's WFileType 5 is PromoFull.
func (b *bina) LatestPromoFull(ctx context.Context, storeID string) (FileRef, error) {
	return b.latest(ctx, "5", "PromoFull", storeID)
}

func (b *bina) latest(ctx context.Context, fileType, kind, storeID string) (FileRef, error) {
	l, err := b.list(ctx, fileType, "")
	if err != nil {
		return FileRef{}, err
	}
	var mine []FileRef
	for _, f := range l {
		if hasPrefixFold(f.Name, kind) && strings.Contains(f.Name, storeTag(storeID)) {
			mine = append(mine, f)
		}
	}
	if len(mine) == 0 {
		return FileRef{}, ErrNotPublished{b.chain, storeID}
	}
	return newest(mine), nil
}

// Open resolves Download.aspx, which answers with JSON naming the real file URL.
func (b *bina) Open(ctx context.Context, f FileRef) (io.ReadCloser, error) {
	resp, err := get(ctx, b.c, f.URL)
	if err != nil {
		return nil, err
	}
	var sp []struct {
		SPath string `json:"SPath"`
	}
	err = json.NewDecoder(resp.Body).Decode(&sp)
	resp.Body.Close()
	if err != nil || len(sp) == 0 || sp[0].SPath == "" {
		return nil, fmt.Errorf("%s: no download path for %s", b.chain, f.Name)
	}
	r, err := get(ctx, b.c, sp[0].SPath)
	if err != nil {
		return nil, err
	}
	return r.Body, nil
}

// ---------------- PublishPrice (prices.<chain>.co.il) ----------------
// Carrefour / Yayno Bitan and Quik. The page embeds `const path = '...'` and the file names.

type publishPrice struct {
	c     *http.Client
	chain string
	base  string
}

// pubFilesRx finds the `const files = [...]` array the page embeds (one line in the original
// scraper, which also reads the folder from `const path = '...'`). The next line holds the chain
// list, which has "name" fields too, so the file names must come from the files array only.
var pubFilesRx = regexp.MustCompile(`const files\s*=\s*(\[.*\])\s*;?`)

func (p *publishPrice) index(ctx context.Context) ([]FileRef, error) {
	base := strings.TrimRight(p.base, "/")
	h, err := getText(ctx, p.c, base+"/")
	if err != nil {
		return nil, err
	}
	m := carPathRx.FindStringSubmatch(h)
	if m == nil {
		return nil, fmt.Errorf("%s: index format changed", p.chain)
	}
	var names []string
	if fm := pubFilesRx.FindStringSubmatch(h); fm != nil {
		var rows []struct {
			Name string `json:"name"`
		}
		if json.Unmarshal([]byte(fm[1]), &rows) == nil {
			for _, r := range rows {
				names = append(names, r.Name)
			}
		}
	}
	if names == nil { // the array's shape changed: fall back to every "name" on the page
		for _, n := range carNameRx.FindAllStringSubmatch(h, -1) {
			names = append(names, n[1])
		}
	}
	var out []FileRef
	for _, n := range names {
		if n != "" {
			out = append(out, FileRef{Name: n, URL: fmt.Sprintf("%s/%s/%s", base, m[1], n)})
		}
	}
	return out, nil
}

func (p *publishPrice) Stores(ctx context.Context) ([]StoreRow, error) {
	idx, err := p.index(ctx)
	if err != nil {
		return nil, err
	}
	var st []FileRef
	for _, f := range idx {
		if hasPrefixFold(f.Name, "Stores") {
			st = append(st, f)
		}
	}
	if len(st) == 0 {
		return nil, fmt.Errorf("%s: no Stores file", p.chain)
	}
	rc, err := p.Open(ctx, newest(st))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return ParseStoresFile(rc, p.chain)
}

func (p *publishPrice) LatestPriceFull(ctx context.Context, storeID string) (FileRef, error) {
	return p.latest(ctx, "PriceFull", storeID)
}

func (p *publishPrice) LatestPromoFull(ctx context.Context, storeID string) (FileRef, error) {
	return p.latest(ctx, "PromoFull", storeID)
}

func (p *publishPrice) latest(ctx context.Context, kind, storeID string) (FileRef, error) {
	idx, err := p.index(ctx)
	if err != nil {
		return FileRef{}, err
	}
	var mine []FileRef
	for _, f := range idx {
		if hasPrefixFold(f.Name, kind) && strings.Contains(f.Name, storeTag(storeID)) {
			mine = append(mine, f)
		}
	}
	if len(mine) == 0 {
		return FileRef{}, ErrNotPublished{p.chain, storeID}
	}
	return newest(mine), nil
}

func (p *publishPrice) Open(ctx context.Context, f FileRef) (io.ReadCloser, error) {
	r, err := get(ctx, p.c, f.URL)
	if err != nil {
		return nil, err
	}
	return r.Body, nil
}

// ---------------- laibcatalog.co.il API (Victory, Mahsanei HaShuk, H. Cohen) ----------------

type laibcatalog struct {
	c     *http.Client
	chain string
	edis  []string
	files []FileRef
}

func (l *laibcatalog) list(ctx context.Context) ([]FileRef, error) {
	if l.files != nil {
		return l.files, nil
	}
	var out []FileRef
	var lastErr error
	for _, edi := range l.edis {
		resp, err := get(ctx, l.c, laibURL+"/webapi/api/getfiles?edi="+edi)
		if err != nil { // a sub-chain with no branches answers 400; keep going
			lastErr = err
			continue
		}
		var rows []struct {
			FileName string `json:"fileName"`
		}
		err = json.NewDecoder(resp.Body).Decode(&rows)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		for _, r := range rows {
			if r.FileName != "" {
				out = append(out, FileRef{Name: r.FileName, URL: laibURL + "/webapi/" + l.edis[0] + "/" + r.FileName})
			}
		}
	}
	if len(out) == 0 && lastErr != nil {
		return nil, fmt.Errorf("%s: %w", l.chain, lastErr)
	}
	l.files = out
	return out, nil
}

func (l *laibcatalog) Stores(ctx context.Context) ([]StoreRow, error) {
	fs, err := l.list(ctx)
	if err != nil {
		return nil, err
	}
	var st []FileRef
	for _, f := range fs {
		if hasPrefixFold(f.Name, "Stores") {
			st = append(st, f)
		}
	}
	if len(st) == 0 {
		return nil, fmt.Errorf("%s: no Stores file", l.chain)
	}
	rc, err := l.Open(ctx, newest(st))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return ParseStoresFile(rc, l.chain)
}

func (l *laibcatalog) LatestPriceFull(ctx context.Context, storeID string) (FileRef, error) {
	return l.latest(ctx, "PriceFull", storeID)
}

func (l *laibcatalog) LatestPromoFull(ctx context.Context, storeID string) (FileRef, error) {
	return l.latest(ctx, "PromoFull", storeID)
}

func (l *laibcatalog) latest(ctx context.Context, kind, storeID string) (FileRef, error) {
	fs, err := l.list(ctx)
	if err != nil {
		return FileRef{}, err
	}
	var mine []FileRef
	for _, f := range fs {
		if hasPrefixFold(f.Name, kind) && strings.Contains(f.Name, storeTag(storeID)) {
			mine = append(mine, f)
		}
	}
	if len(mine) == 0 {
		return FileRef{}, ErrNotPublished{l.chain, storeID}
	}
	return newest(mine), nil
}

func (l *laibcatalog) Open(ctx context.Context, f FileRef) (io.ReadCloser, error) {
	r, err := get(ctx, l.c, f.URL)
	if err != nil {
		return nil, err
	}
	return r.Body, nil
}

// ---------------- Wolt Market ----------------
// A daily index: v1/<YYYY-MM-DD>.html lists download/<date>/<file>.gz links.

const woltURL = "https://wm-gateway.wolt.com/isr-prices/public/v1/"

type wolt struct {
	c     *http.Client
	files []FileRef
}

var woltHrefRx = regexp.MustCompile(`href="(download/[^"]+)"`)

func (w *wolt) list(ctx context.Context) ([]FileRef, error) {
	if w.files != nil {
		return w.files, nil
	}
	var out []FileRef
	for back := 0; back < 3 && len(out) == 0; back++ { // today's page can be empty just after midnight
		day := time.Now().AddDate(0, 0, -back).Format("2006-01-02")
		h, err := getText(ctx, w.c, woltURL+day+".html")
		if err != nil {
			continue
		}
		for _, m := range woltHrefRx.FindAllStringSubmatch(h, -1) {
			out = append(out, FileRef{Name: path(m[1]), URL: woltURL + m[1]})
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("wolt: no files listed for the last 3 days")
	}
	w.files = out
	return out, nil
}

func (w *wolt) Stores(ctx context.Context) ([]StoreRow, error) {
	fs, err := w.list(ctx)
	if err != nil {
		return nil, err
	}
	var st []FileRef
	for _, f := range fs {
		if hasPrefixFold(f.Name, "Stores") {
			st = append(st, f)
		}
	}
	if len(st) == 0 {
		return nil, fmt.Errorf("wolt: no Stores file")
	}
	rc, err := w.Open(ctx, newest(st))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return ParseStoresFile(rc, "wolt")
}

func (w *wolt) LatestPriceFull(ctx context.Context, storeID string) (FileRef, error) {
	return w.latest(ctx, "PriceFull", storeID)
}

func (w *wolt) LatestPromoFull(ctx context.Context, storeID string) (FileRef, error) {
	return w.latest(ctx, "PromoFull", storeID)
}

func (w *wolt) latest(ctx context.Context, kind, storeID string) (FileRef, error) {
	fs, err := w.list(ctx)
	if err != nil {
		return FileRef{}, err
	}
	var mine []FileRef
	for _, f := range fs {
		if hasPrefixFold(f.Name, kind) && strings.Contains(f.Name, storeTag(storeID)) {
			mine = append(mine, f)
		}
	}
	if len(mine) == 0 {
		return FileRef{}, ErrNotPublished{"wolt", storeID}
	}
	return newest(mine), nil
}

func (w *wolt) Open(ctx context.Context, f FileRef) (io.ReadCloser, error) {
	r, err := get(ctx, w.c, f.URL)
	if err != nil {
		return nil, err
	}
	return r.Body, nil
}

// ---------------- Hazi Hinam (shop.hazi-hinam.co.il/Prices) ----------------
// A paged HTML table, filtered by query string: d=<YYYY-MM-DD>, t=<type: 3 Stores, 1 Price/PriceFull,
// 2 Promo>, f=null, and &p=<page>. Column 1 is the date, column 3 the file name (without extension;
// the original scraper appends ".xml.gz"), column 6 the download link. Source: scrappers/hazihinam.py.

var haziURL = "https://shop.hazi-hinam.co.il/Prices"

type haziHinam struct {
	c     *http.Client
	files map[string][]FileRef // by "type|date"
}

var (
	haziRowRx  = regexp.MustCompile(`(?s)<tr[^>]*>(.*?)</tr>`)
	haziCellRx = regexp.MustCompile(`(?s)<td[^>]*>(.*?)</td>`)
	haziHrefRx = regexp.MustCompile(`href="([^"]+)"`)
	tagRx      = regexp.MustCompile(`<[^>]+>`)
)

// haziMaxPages bounds one day's listing (20 rows a page).
const haziMaxPages = 150

// list returns one day's files of one type, following the pages until one adds nothing new.
func (h *haziHinam) list(ctx context.Context, typ, day string) ([]FileRef, error) {
	key := typ + "|" + day
	if fs, ok := h.files[key]; ok {
		return fs, nil
	}
	var out []FileRef
	seen := map[string]bool{}
	base, _ := url.Parse(haziURL)
	for page := 1; page <= haziMaxPages; page++ {
		q := url.Values{"d": {day}, "t": {typ}, "f": {"null"}, "p": {fmt.Sprint(page)}}
		body, err := getText(ctx, h.c, haziURL+"?"+q.Encode())
		if err != nil {
			if page == 1 {
				return nil, err
			}
			break
		}
		added := 0
		for _, row := range haziRowRx.FindAllStringSubmatch(body, -1) {
			cells := haziCellRx.FindAllStringSubmatch(row[1], -1)
			if len(cells) < 6 {
				continue
			}
			name := strings.TrimSpace(tagRx.ReplaceAllString(cells[2][1], ""))
			href := haziHrefRx.FindStringSubmatch(cells[5][1])
			if name == "" || href == nil {
				continue
			}
			if !strings.Contains(name, ".") {
				name += ".xml.gz"
			}
			u, err := url.Parse(strings.ReplaceAll(href[1], "&amp;", "&"))
			if err != nil || seen[name] {
				continue
			}
			seen[name] = true
			out = append(out, FileRef{Name: name, URL: base.ResolveReference(u).String()})
			added++
		}
		if added == 0 {
			break
		}
	}
	if h.files == nil {
		h.files = map[string][]FileRef{}
	}
	h.files[key] = out
	return out, nil
}

// haziDays are the listing dates to try, newest first (the original asks for today and yesterday).
func haziDays() []string {
	now := time.Now().In(time.FixedZone("IL", 3*3600)) // Israel is UTC+2/+3; yesterday covers the difference
	return []string{now.Format("2006-01-02"), now.AddDate(0, 0, -1).Format("2006-01-02")}
}

func (h *haziHinam) Stores(ctx context.Context) ([]StoreRow, error) {
	var st []FileRef
	var lastErr error
	for _, day := range haziDays() {
		fs, err := h.list(ctx, "3", day)
		if err != nil {
			lastErr = err
			continue
		}
		for _, f := range fs {
			if hasPrefixFold(f.Name, "Stores") {
				st = append(st, f)
			}
		}
		if len(st) > 0 {
			break
		}
	}
	if len(st) == 0 {
		if lastErr != nil {
			return nil, fmt.Errorf("hazihinam: %w", lastErr)
		}
		return nil, fmt.Errorf("hazihinam: no Stores file")
	}
	rc, err := h.Open(ctx, newest(st))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return ParseStoresFile(rc, "hazihinam")
}

func (h *haziHinam) LatestPriceFull(ctx context.Context, storeID string) (FileRef, error) {
	return h.latest(ctx, "1", "PriceFull", storeID)
}

func (h *haziHinam) LatestPromoFull(ctx context.Context, storeID string) (FileRef, error) {
	return h.latest(ctx, "2", "PromoFull", storeID)
}

// latest finds a store's newest file of a kind; listType is the site's t= filter
// (1 Price/PriceFull, 2 Promo/PromoFull, 3 Stores). Today first, then yesterday.
func (h *haziHinam) latest(ctx context.Context, listType, kind, storeID string) (FileRef, error) {
	var lastErr error
	for _, day := range haziDays() {
		fs, err := h.list(ctx, listType, day)
		if err != nil {
			lastErr = err
			continue
		}
		var mine []FileRef
		for _, f := range fs {
			if hasPrefixFold(f.Name, kind) && strings.Contains(f.Name, storeTag(storeID)) {
				mine = append(mine, f)
			}
		}
		if len(mine) > 0 {
			return newest(mine), nil
		}
	}
	if lastErr != nil {
		return FileRef{}, fmt.Errorf("hazihinam: %w", lastErr)
	}
	return FileRef{}, ErrNotPublished{"hazihinam", storeID}
}

func (h *haziHinam) Open(ctx context.Context, f FileRef) (io.ReadCloser, error) {
	r, err := get(ctx, h.c, f.URL)
	if err != nil {
		return nil, err
	}
	return r.Body, nil
}
