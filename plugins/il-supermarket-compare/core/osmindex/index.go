// Package osmindex builds and queries a compact offline geocoding index for Israeli
// addresses from an OpenStreetMap extract (© OpenStreetMap contributors, ODbL).
package osmindex

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

// Coordinates are int32 microdegrees.
const micro = 1e6

// Precision levels returned by Lookup.
const (
	PrecHouse  = "house"
	PrecStreet = "street"
	PrecPOI    = "poi"
	PrecCity   = "city"
	PrecBranch = "branch"
)

type City struct {
	Name     string   // display name
	Names    []string // normalised variants (NormCity)
	Lat, Lon int32
}

type House struct {
	Num      int32
	Suf      string // "" or a letter: 12א
	Lat, Lon int32
}

type Street struct {
	City     int32
	Names    []string // normalised, primary first
	Lat, Lon int32    // representative point on the street
	Houses   []House  // sorted by Num, Suf
}

type POI struct {
	City     int32
	Name     string // NormPOI key
	Lat, Lon int32
}

// Brand is a named supermarket/convenience POI (see branch matching).
type Brand struct {
	City     int32
	Brand    string // normalised brand key
	Name     string // normalised POI name
	Lat, Lon int32
}

// Index is read-only after Prepare / Load and safe for concurrent Lookup calls.
type Index struct {
	Cities  []City
	Streets []Street
	POIs    []POI
	Brands  []Brand

	cityByName   map[string][]int32
	cityBySkel   map[string][]int32
	cityStreets  [][]int32
	streetByName map[streetKey]int32
	streetBySkel map[streetKey][]int32
	cityPOIs     [][]int32
	cityBrands   [][]int32
}

type streetKey struct {
	city int32
	name string
}

// Prepare builds the lookup tables; call after filling the exported slices by hand.
func (ix *Index) Prepare() {
	ix.cityByName = map[string][]int32{}
	ix.cityBySkel = map[string][]int32{}
	for i, c := range ix.Cities {
		for _, n := range c.Names {
			ix.cityByName[n] = appendUnique(ix.cityByName[n], int32(i))
			k := Skeleton(n)
			ix.cityBySkel[k] = appendUnique(ix.cityBySkel[k], int32(i))
		}
	}
	ix.cityStreets = make([][]int32, len(ix.Cities))
	ix.streetByName = map[streetKey]int32{}
	ix.streetBySkel = map[streetKey][]int32{}
	for i, s := range ix.Streets {
		ix.cityStreets[s.City] = append(ix.cityStreets[s.City], int32(i))
		for _, n := range s.Names {
			k := streetKey{s.City, n}
			if _, dup := ix.streetByName[k]; !dup {
				ix.streetByName[k] = int32(i)
			}
			sk := streetKey{s.City, Skeleton(n)}
			ix.streetBySkel[sk] = appendUnique(ix.streetBySkel[sk], int32(i))
		}
	}
	ix.cityPOIs = make([][]int32, len(ix.Cities))
	for i, p := range ix.POIs {
		ix.cityPOIs[p.City] = append(ix.cityPOIs[p.City], int32(i))
	}
	ix.cityBrands = make([][]int32, len(ix.Cities))
	for i, p := range ix.Brands {
		ix.cityBrands[p.City] = append(ix.cityBrands[p.City], int32(i))
	}
}

func appendUnique(s []int32, v int32) []int32 {
	for _, x := range s {
		if x == v {
			return s
		}
	}
	return append(s, v)
}

// Result describes how a lookup was answered.
type Result struct {
	Lat, Lon  float64
	Precision string
	Method    string // exact, interpolated, nearest-number, centroid, fuzzy..., poi, city
	Street    string // matched street (normalised)
}

func deg(v int32) float64 { return float64(v) / micro }

// Lookup geocodes a store-style address ("רח' הרצל 15", "קניון עזריאלי") inside a city.
func (ix *Index) Lookup(address, city string) (lat, lon float64, precision string, ok bool) {
	r, ok := ix.LookupDetail(address, city)
	return r.Lat, r.Lon, r.Precision, ok
}

// Cities resolves a city name to candidate city ids.
func (ix *Index) cityIDs(city string) []int32 {
	n := NormCity(city)
	if n == "" {
		return nil
	}
	if ids := ix.cityByName[n]; len(ids) > 0 {
		return ids
	}
	if strings.HasSuffix(n, " יפו") {
		if ids := ix.cityByName[strings.TrimSuffix(n, " יפו")]; len(ids) > 0 {
			return ids
		}
	}
	if ids := ix.cityBySkel[Skeleton(n)]; len(ids) > 0 {
		return ids
	}
	if len([]rune(n)) >= 5 {
		var out []int32
		for name, ids := range ix.cityByName {
			if editDistLE1(name, n) {
				out = append(out, ids...)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
		return out
	}
	return nil
}

// LookupDetail is Lookup with the method used.
func (ix *Index) LookupDetail(address, city string) (Result, bool) {
	cids := ix.cityIDs(city)
	if len(cids) == 0 {
		return Result{}, false
	}
	p := ParseAddress(address, city)
	for _, cid := range cids {
		if r, ok := ix.lookupIn(cid, p); ok {
			return r, true
		}
	}
	c := ix.Cities[cids[0]]
	return Result{Lat: deg(c.Lat), Lon: deg(c.Lon), Precision: PrecCity, Method: "city"}, true
}

func (ix *Index) lookupIn(cid int32, p Parsed) (Result, bool) {
	for tier := 0; tier < 3; tier++ {
		for _, st := range p.Streets {
			if sid, how, ok := ix.findStreet(cid, st, tier); ok {
				return ix.locateOnStreet(sid, p, how), true
			}
		}
	}
	for _, name := range p.POIs {
		if i, ok := ix.findPOI(cid, name); ok {
			q := ix.POIs[i]
			return Result{Lat: deg(q.Lat), Lon: deg(q.Lon), Precision: PrecPOI, Method: "poi", Street: q.Name}, true
		}
	}
	return Result{}, false
}

// findStreet resolves a normalised street name inside one city. Tier 0 is exact / spelling
// skeleton, 1 tolerates one typo (names of 5+ letters), 2 matches by shared words.
func (ix *Index) findStreet(cid int32, name string, tier int) (int32, string, bool) {
	if name == "" {
		return 0, "", false
	}
	switch tier {
	case 0:
		if sid, ok := ix.streetByName[streetKey{cid, name}]; ok {
			return sid, "", true
		}
		if sk := Skeleton(name); len(sk) >= 3 {
			if ids := ix.streetBySkel[streetKey{cid, sk}]; len(ids) > 0 {
				return ix.richest(ids), "+skeleton", true
			}
		}
	case 1:
		if len([]rune(name)) >= 5 {
			var cand []int32
			for _, sid := range ix.cityStreets[cid] {
				for _, n := range ix.Streets[sid].Names {
					if editDistLE1(n, name) {
						cand = append(cand, sid)
						break
					}
				}
			}
			if len(cand) > 0 {
				return ix.richest(cand), "+typo", true
			}
		}
	default:
		// "ויצמן" -> "חיים ויצמן"; "אבא הלל סילבר" -> "אבא הלל"
		qt := strings.Fields(name)
		var cand []int32
		for _, sid := range ix.cityStreets[cid] {
			for _, n := range ix.Streets[sid].Names {
				if tokenSubset(qt, strings.Fields(n)) || tokenSubset(strings.Fields(n), qt) {
					cand = append(cand, sid)
					break
				}
			}
		}
		if len(cand) > 0 {
			return ix.richest(cand), "+tokens", true
		}
	}
	return 0, "", false
}

// tokenSubset: every token of a is in b, a is distinctive (>=5 letters or >=2 tokens), and
// a is a strict subset.
func tokenSubset(a, b []string) bool {
	if len(a) == 0 || len(a) >= len(b) {
		return false
	}
	n := 0
	for _, t := range a {
		n += len([]rune(t))
		found := false
		for _, u := range b {
			if t == u {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return len(a) >= 2 || n >= 5
}

func (ix *Index) richest(ids []int32) int32 {
	best := ids[0]
	for _, id := range ids[1:] {
		if len(ix.Streets[id].Houses) > len(ix.Streets[best].Houses) {
			best = id
		}
	}
	return best
}

func (ix *Index) findPOI(cid int32, name string) (int32, bool) {
	if name == "" {
		return 0, false
	}
	sk := Skeleton(name)
	qt := strings.Fields(name)
	var sub int32 = -1
	for _, i := range ix.cityPOIs[cid] {
		p := ix.POIs[i]
		if p.Name == name {
			return i, true
		}
		if Skeleton(p.Name) == sk && len(sk) >= 3 {
			return i, true
		}
		if sub < 0 && len([]rune(p.Name)) >= 4 && tokenSubsetAny(strings.Fields(p.Name), qt) {
			sub = i
		}
	}
	return sub, sub >= 0
}

func tokenSubsetAny(a, b []string) bool {
	if len(a) == 0 {
		return false
	}
	for _, t := range a {
		ok := false
		for _, u := range b {
			if t == u {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func (ix *Index) locateOnStreet(sid int32, p Parsed, how string) Result {
	s := ix.Streets[sid]
	name := s.Names[0]
	if p.Num > 0 && len(s.Houses) > 0 {
		if lat, lon, method, ok := locateHouse(s.Houses, int32(p.Num), p.Suf); ok {
			prec := PrecHouse
			if method == "nearest-number" {
				prec = PrecStreet
			}
			return Result{Lat: lat, Lon: lon, Precision: prec, Method: method + how, Street: name}
		}
	}
	return Result{Lat: deg(s.Lat), Lon: deg(s.Lon), Precision: PrecStreet, Method: "centroid" + how, Street: name}
}

// maxInterpKm: do not interpolate between neighbours farther apart than this.
const maxInterpKm = 1.5

func locateHouse(hs []House, num int32, suf string) (lat, lon float64, method string, ok bool) {
	var anyNum *House
	for i := range hs {
		h := &hs[i]
		if h.Num == num {
			if h.Suf == suf {
				return deg(h.Lat), deg(h.Lon), "exact", true
			}
			if anyNum == nil || h.Suf == "" {
				anyNum = h
			}
		}
	}
	if anyNum != nil {
		return deg(anyNum.Lat), deg(anyNum.Lon), "exact", true
	}
	// neighbours on the same side of the street (same parity) first, then any side
	for _, sameParity := range []bool{true, false} {
		var lo, hi *House
		for i := range hs {
			h := &hs[i]
			if sameParity && (h.Num%2 != num%2) {
				continue
			}
			if h.Num < num && (lo == nil || h.Num > lo.Num) {
				lo = h
			}
			if h.Num > num && (hi == nil || h.Num < hi.Num) {
				hi = h
			}
		}
		if lo != nil && hi != nil {
			if kmBetween(deg(lo.Lat), deg(lo.Lon), deg(hi.Lat), deg(hi.Lon)) <= maxInterpKm {
				f := float64(num-lo.Num) / float64(hi.Num-lo.Num)
				return deg(lo.Lat) + f*(deg(hi.Lat)-deg(lo.Lat)), deg(lo.Lon) + f*(deg(hi.Lon)-deg(lo.Lon)), "interpolated", true
			}
		}
	}
	// beyond the range: the closest known number (better than the middle of a long street)
	var best *House
	bd := int32(math.MaxInt32)
	for i := range hs {
		h := &hs[i]
		d := h.Num - num
		if d < 0 {
			d = -d
		}
		if h.Num%2 != num%2 {
			d += 3
		}
		if d < bd {
			best, bd = h, d
		}
	}
	if best != nil && bd <= 20 {
		return deg(best.Lat), deg(best.Lon), "nearest-number", true
	}
	return 0, 0, "", false
}

func kmBetween(lat1, lon1, lat2, lon2 float64) float64 {
	r := math.Pi / 180
	dp, dl := (lat2-lat1)*r, (lon2-lon1)*r
	x := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(lat1*r)*math.Cos(lat2*r)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * 6371 * math.Asin(math.Sqrt(x))
}

// Parsed is a store address split into candidate street keys and a house number.
type Parsed struct {
	Streets []string // normalised candidates, best first
	POIs    []string // NormPOI candidates
	Num     int
	Suf     string
}

var noiseWords = map[string]bool{"בניין": true, "קומה": true, "כניסה": true, "ליד": true, "מול": true}

// ParseAddress cleans a messy store-file address.
func ParseAddress(addr, city string) Parsed {
	var p Parsed
	if strings.HasPrefix(strings.TrimSpace(addr), "http") {
		return p
	}
	// parenthesised remarks
	for {
		i := strings.IndexByte(addr, '(')
		j := strings.IndexByte(addr, ')')
		if i < 0 || j < i {
			break
		}
		addr = addr[:i] + " " + addr[j+1:]
	}
	// "ברשבסקי 33|" / "חורב 15 | www..."
	if i := strings.IndexByte(addr, '|'); i >= 0 {
		if head := strings.TrimSpace(addr[:i]); head != "" {
			addr = head
		} else {
			addr = addr[i+1:]
		}
	}
	corner := ""
	for _, kw := range []string{"פינת", "פינה"} {
		if i := strings.Index(addr, kw); i >= 0 {
			corner = addr[i+len(kw):]
			addr = addr[:i]
		}
	}
	var alt []string // second half of "כצנלסון/מנדל 67"
	if i := strings.IndexByte(addr, '/'); i > 0 {
		alt = tokens(addr[i+1:])
		addr = addr[:i] + " " + addr[i+1:]
	}
	toks := splitGlued(fixTokens(tokens(addr)))
	toks = removeCity(toks, city)

	// house number: first token starting with a digit
	var street []string
	numIdx := -1
	for i, t := range toks {
		if t[0] >= '0' && t[0] <= '9' {
			numIdx = i
			digits := strings.TrimRightFunc(t, func(r rune) bool { return r < '0' || r > '9' })
			p.Num, _ = strconv.Atoi(digits)
			if rest := strings.TrimPrefix(t, digits); len([]rune(rest)) == 1 {
				p.Suf = rest
			} else if i+1 < len(toks) && len([]rune(toks[i+1])) == 1 && hasLetter(toks[i+1]) {
				p.Suf = toks[i+1]
			}
			break
		}
	}
	for i, t := range toks {
		if numIdx > 0 && i > numIdx {
			break
		}
		if t[0] >= '0' && t[0] <= '9' || noiseWords[t] {
			continue
		}
		street = append(street, t)
	}
	p.Suf = strings.ToLower(p.Suf)
	push := func(k string) {
		if k == "" {
			return
		}
		for _, e := range p.Streets {
			if e == k {
				return
			}
		}
		p.Streets = append(p.Streets, k)
	}
	add := func(ts []string) {
		for len(ts) > 1 && streetPrefix[ts[0]] {
			ts = ts[1:]
		}
		k := strings.Join(ts, " ")
		push(k)
		// definite article: "הלחי" / "לחי"
		if len(ts) == 1 {
			if r := []rune(k); len(r) >= 4 && r[0] == 'ה' {
				push(string(r[1:]))
			} else if len(r) >= 3 {
				push("ה" + k)
			}
		}
	}
	add(street)
	// drop shopping-centre words: "מרכז מסחרי הרצל 5" -> "הרצל"
	stripped := make([]string, 0, len(street))
	for _, t := range street {
		if !poiGeneric[t] {
			stripped = append(stripped, t)
		}
	}
	if len(stripped) > 0 && len(stripped) != len(street) {
		add(stripped)
	}
	if len(alt) > 0 {
		var cs []string
		for _, t := range alt {
			if t[0] < '0' || t[0] > '9' {
				cs = append(cs, t)
			}
		}
		add(cs)
	}
	if corner != "" {
		ct := fixTokens(tokens(corner))
		ct = removeCity(ct, city)
		var cs []string
		for _, t := range ct {
			if t[0] < '0' || t[0] > '9' {
				cs = append(cs, t)
			}
		}
		add(cs)
	}
	if len(street) > 0 {
		p.POIs = append(p.POIs, NormPOI(strings.Join(street, " ")))
	}
	return p
}

// removeCity drops the city name (and its abbreviation, ר"ג) from the tokens, unless that
// would leave no words at all.
func removeCity(toks []string, city string) []string {
	var exp []string
	for _, w := range toks {
		if full, ok := cityAbbr[w]; ok && w != full {
			exp = append(exp, strings.Fields(full)...)
		} else {
			exp = append(exp, w)
		}
	}
	ct := strings.Fields(NormCity(city))
	variants := [][]string{ct}
	if n := len(ct); n > 1 && ct[n-1] == "יפו" {
		variants = append(variants, ct[:n-1])
	}
	out := exp
	for _, v := range variants {
		if len(v) == 0 {
			continue
		}
		var res []string
		for i := 0; i < len(out); {
			if i+len(v) <= len(out) && strings.Join(out[i:i+len(v)], " ") == strings.Join(v, " ") {
				i += len(v)
				continue
			}
			res = append(res, out[i])
			i++
		}
		hasWord := false
		for _, t := range res {
			if t[0] < '0' || t[0] > '9' {
				hasWord = true
			}
		}
		if hasWord {
			out = res
			break
		}
	}
	return out
}

// splitGlued separates numbers glued to words ("מלצר20", "1זנגוויל", "שדרותרבין").
func splitGlued(toks []string) []string {
	var out []string
	for _, t := range toks {
		r := []rune(t)
		isD := func(c rune) bool { return c >= '0' && c <= '9' }
		switch {
		case isD(r[0]):
			i := 0
			for i < len(r) && isD(r[i]) {
				i++
			}
			if len(r)-i >= 2 {
				out = append(out, string(r[:i]), string(r[i:]))
				continue
			}
		case !isD(r[len(r)-1]) && len(r) > 7 && strings.HasPrefix(t, "שדרות"):
			out = append(out, "שדרות", string(r[5:]))
			continue
		default:
			i := len(r)
			for i > 0 && isD(r[i-1]) {
				i--
			}
			if i > 1 && i < len(r) {
				out = append(out, string(r[:i]), string(r[i:]))
				continue
			}
		}
		out = append(out, t)
	}
	return out
}
