package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Israeli chains must publish full XML price files per branch, updated daily
// (חוק קידום התחרות בענף המזון). Covered portals:
//   - Shufersal (incl. Yesh Hesed, Universe, Deal, Express, Sheli)
//   - url.publishedprices.co.il (public per-chain usernames, empty password)
//   - Carrefour (incl. Carrefour City / Market)

// carrefourURL is a variable so tests can point the client at a test server.
var carrefourURL = "https://prices.carrefour.co.il"

const userAgent = "salzol/0.1 (personal grocery price comparison)"

// PublishedPricesUsers maps the portal username to the chain's Hebrew name.
var PublishedPricesUsers = map[string]string{
	"RamiLevi": "רמי לוי", "osherad": "אושר עד", "yohananof": "יוחננוף", "TivTaam": "טיב טעם",
	"Keshet": "קשת טעמים", "doralon": "דור אלון (am:pm)", "freshmarket": "פרשמרקט",
	"SalachD": "סאלח דבאח", "Stop_Market": "סטופ מרקט", "politzer": "פוליצר",
	"Paz_bo": "יילו", "yuda_ho": "סופר יודה", "SuperCofixApp": "קופיקס",
}

// ppLogins holds the portal logins that aren't "username, empty password, root folder". The chains
// publish these credentials themselves, as the price-transparency law requires (source: see
// portals_extra.go).
var ppLogins = map[string]struct{ password, folder string }{
	"SalachD": {password: "12345"},
	"Paz_bo":  {password: "paz468"},
	"yuda_ho": {password: "Yud@147", folder: "/Yuda"},
}

// FileRef points at one published file. Name is stable for a given publication, so it doubles as a cache key.
type FileRef struct {
	Name string
	URL  string
}

// Portal lists and downloads one chain's files. A Portal keeps its login session, so reuse it for
// several stores of the same chain, but don't share it between goroutines.
type Portal interface {
	Stores(ctx context.Context) ([]StoreRow, error)
	LatestPriceFull(ctx context.Context, storeID string) (FileRef, error)
	// LatestPromoFull finds the store's newest PromoFull file. ErrNotPublished means it has none.
	LatestPromoFull(ctx context.Context, storeID string) (FileRef, error)
	Open(ctx context.Context, f FileRef) (io.ReadCloser, error)
}

// ErrNotPublished means the branch has no PriceFull today (closed, Shabbat, or late).
type ErrNotPublished struct{ Chain, StoreID string }

func (e ErrNotPublished) Error() string {
	return fmt.Sprintf("%s:%s has not published a PriceFull file today (closed, Shabbat, or late)", e.Chain, e.StoreID)
}

func NewPortal(chain string, client *http.Client) (Portal, error) {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Minute}
	}
	switch chain {
	case "shufersal":
		return &shufersal{c: client}, nil
	case "carrefour": // Carrefour and Yayno Bitan
		return &publishPrice{c: client, chain: chain, base: carrefourURL}, nil
	}
	if p, ok := newExtraPortal(chain, client); ok {
		return p, nil
	}
	if _, ok := PublishedPricesUsers[chain]; ok {
		jar, _ := cookiejar.New(nil)
		c := *client
		c.Jar = jar
		return &publishedPrices{c: &c, user: chain}, nil
	}
	return nil, fmt.Errorf("unknown chain %q", chain)
}

func get(ctx context.Context, c *http.Client, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: HTTP %d", redact(u), resp.StatusCode)
	}
	return resp, nil
}

func getText(ctx context.Context, c *http.Client, u string) (string, error) {
	resp, err := get(ctx, c, u)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}

// redact drops query strings (Shufersal's links carry signed tokens) from error messages.
func redact(u string) string {
	if i := strings.IndexByte(u, '?'); i >= 0 {
		return u[:i]
	}
	return u
}

// fileStamp returns a published file's timestamp as YYYYMMDDhhmm. Portals write it as
// ...-202611120630.gz or ...-20261112-030000.gz, so both shapes are normalized.
var stampRx = regexp.MustCompile(`(\d{8})-?(\d{4,6})?(?:\.\w+)*$`)

func fileStamp(name string) string {
	m := stampRx.FindStringSubmatch(name)
	if m == nil {
		return name
	}
	t := (m[2] + "0000")[:4]
	return m[1] + t
}

func newest(files []FileRef) FileRef {
	sort.Slice(files, func(i, j int) bool { return fileStamp(files[i].Name) < fileStamp(files[j].Name) })
	return files[len(files)-1]
}

func storeTag(storeID string) string {
	n := 0
	fmt.Sscanf(storeID, "%d", &n)
	return fmt.Sprintf("-%03d-", n)
}

// ---------------- Shufersal ----------------

const shufURL = "https://prices.shufersal.co.il/FileObject/UpdateCategory"

type shufersal struct{ c *http.Client }

var hrefRx = regexp.MustCompile(`href="(https://[^"]+)"`)
var shufNameRx = regexp.MustCompile(`((?:PriceFull|Price|PromoFull|Promo|Stores)\d+-[\d-]+)`)

func (s *shufersal) links(ctx context.Context, cat, store string) ([]FileRef, error) {
	h, err := getText(ctx, s.c, fmt.Sprintf("%s?catID=%s&storeId=%s", shufURL, cat, store))
	if err != nil {
		return nil, err
	}
	var out []FileRef
	for _, m := range hrefRx.FindAllStringSubmatch(strings.ReplaceAll(h, "&amp;", "&"), -1) {
		name := path(m[1])
		if n := shufNameRx.FindString(m[1]); n != "" {
			name = n
		}
		out = append(out, FileRef{Name: name, URL: m[1]})
	}
	return out, nil
}

func path(u string) string {
	p, err := url.Parse(u)
	if err != nil {
		return u
	}
	parts := strings.Split(p.Path, "/")
	return parts[len(parts)-1]
}

func (s *shufersal) Stores(ctx context.Context) ([]StoreRow, error) {
	l, err := s.links(ctx, "5", "0")
	if err != nil || len(l) == 0 {
		return nil, fmt.Errorf("shufersal stores list: %v", err)
	}
	rc, err := s.Open(ctx, l[0])
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return ParseStoresFile(rc, "shufersal")
}

func (s *shufersal) LatestPriceFull(ctx context.Context, storeID string) (FileRef, error) {
	return s.latest(ctx, "2", "PriceFull", storeID)
}

// LatestPromoFull: Shufersal's category 4 is PromoFull (3 is the intraday Promo).
func (s *shufersal) LatestPromoFull(ctx context.Context, storeID string) (FileRef, error) {
	return s.latest(ctx, "4", "PromoFull", storeID)
}

func (s *shufersal) latest(ctx context.Context, cat, prefix, storeID string) (FileRef, error) {
	l, err := s.links(ctx, cat, storeID)
	if err != nil {
		return FileRef{}, err
	}
	var full []FileRef
	for _, f := range l {
		if strings.HasPrefix(f.Name, prefix) {
			full = append(full, f)
		}
	}
	if len(full) == 0 {
		return FileRef{}, ErrNotPublished{"shufersal", storeID}
	}
	return newest(full), nil
}

func (s *shufersal) Open(ctx context.Context, f FileRef) (io.ReadCloser, error) {
	resp, err := get(ctx, s.c, f.URL)
	if err != nil {
		return nil, err
	}
	return resp.Body, nil
}

// ---------------- publishedprices.co.il ----------------

const ppURL = "https://url.publishedprices.co.il"

type publishedPrices struct {
	c     *http.Client
	user  string
	token string
}

var csrfRx = regexp.MustCompile(`name="csrftoken" content="([^"]+)"`)

func (p *publishedPrices) login(ctx context.Context) error {
	if p.token != "" {
		return nil
	}
	h, err := getText(ctx, p.c, ppURL+"/login")
	if err != nil {
		return err
	}
	m := csrfRx.FindStringSubmatch(h)
	if m == nil {
		return fmt.Errorf("publishedprices: no login token for %s", p.user)
	}
	if err := p.post(ctx, "/login/user", url.Values{"username": {p.user}, "password": {ppLogins[p.user].password}, "csrftoken": {m[1]}}, nil); err != nil {
		return err
	}
	h, err = getText(ctx, p.c, ppURL+"/file")
	if err != nil {
		return err
	}
	if m = csrfRx.FindStringSubmatch(h); m == nil {
		return fmt.Errorf("publishedprices login failed for %s", p.user)
	}
	p.token = m[1]
	return nil
}

func (p *publishedPrices) post(ctx context.Context, path string, form url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, "POST", ppURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := p.c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("POST %s: HTTP %d", path, resp.StatusCode)
	}
	if out == nil {
		_, err = io.Copy(io.Discard, resp.Body)
		return err
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (p *publishedPrices) list(ctx context.Context, search string) ([]FileRef, error) {
	if err := p.login(ctx); err != nil {
		return nil, err
	}
	folder := ppLogins[p.user].folder
	if folder == "" {
		folder = "/"
	}
	out, subs, err := p.dir(ctx, folder, search)
	if err != nil {
		return nil, err
	}
	// Some accounts keep their files in sub-folders ("/Yuda/stores"): look one level down.
	for _, sub := range subs {
		more, _, err := p.dir(ctx, strings.TrimRight(folder, "/")+"/"+sub, search)
		if err == nil {
			out = append(out, more...)
		}
	}
	return out, nil
}

// dir lists one folder: the files in it, and the names of its sub-folders. A price-file name always
// has digits (chain id, date); an entry without any is a folder.
func (p *publishedPrices) dir(ctx context.Context, folder, search string) ([]FileRef, []string, error) {
	var r struct {
		AAData []struct {
			Fname string `json:"fname"`
			Ftype string `json:"ftype"`
		} `json:"aaData"`
	}
	form := url.Values{"sEcho": {"1"}, "iDisplayStart": {"0"}, "iDisplayLength": {"100000"}, "sSearch": {search}, "cd": {folder}, "csrftoken": {p.token}}
	if err := p.post(ctx, "/file/json/dir", form, &r); err != nil {
		return nil, nil, err
	}
	prefix := strings.Trim(folder, "/")
	if prefix != "" {
		prefix += "/"
	}
	var files []FileRef
	var subs []string
	for _, f := range r.AAData {
		if f.Ftype == "folder" || !strings.ContainsAny(f.Fname, "0123456789") {
			if f.Fname != "" && f.Fname != "." && f.Fname != ".." {
				subs = append(subs, f.Fname)
			}
			continue
		}
		files = append(files, FileRef{Name: f.Fname, URL: ppURL + "/file/d/" + prefix + f.Fname})
	}
	return files, subs, nil
}

func (p *publishedPrices) Stores(ctx context.Context) ([]StoreRow, error) {
	l, err := p.list(ctx, "Stores")
	if err != nil {
		return nil, err
	}
	if len(l) == 0 {
		return nil, fmt.Errorf("%s: no Stores file", p.user)
	}
	rc, err := p.Open(ctx, newest(l))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return ParseStoresFile(rc, p.user)
}

func (p *publishedPrices) LatestPriceFull(ctx context.Context, storeID string) (FileRef, error) {
	return p.latest(ctx, "PriceFull", storeID)
}

func (p *publishedPrices) LatestPromoFull(ctx context.Context, storeID string) (FileRef, error) {
	return p.latest(ctx, "PromoFull", storeID)
}

func (p *publishedPrices) latest(ctx context.Context, kind, storeID string) (FileRef, error) {
	l, err := p.list(ctx, kind)
	if err != nil {
		return FileRef{}, err
	}
	tag := storeTag(storeID)
	var mine []FileRef
	for _, f := range l {
		if strings.Contains(f.Name, tag) && strings.Contains(strings.ToLower(f.Name), strings.ToLower(kind)) {
			mine = append(mine, f)
		}
	}
	if len(mine) == 0 {
		return FileRef{}, ErrNotPublished{p.user, storeID}
	}
	return newest(mine), nil
}

func (p *publishedPrices) Open(ctx context.Context, f FileRef) (io.ReadCloser, error) {
	if err := p.login(ctx); err != nil {
		return nil, err
	}
	resp, err := get(ctx, p.c, f.URL)
	if err != nil {
		return nil, err
	}
	return resp.Body, nil
}

// ---------------- Carrefour / PublishPrice ----------------
// See publishPrice in portals_extra.go. These two patterns parse its index page.

var carPathRx = regexp.MustCompile(`const path = ['"]([^'"]+)['"]`)
var carNameRx = regexp.MustCompile(`"name":"([^"]+)"`)
