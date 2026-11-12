package osmindex

import (
	"context"
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"
)

type scanOpts struct{ nodes, ways, rels bool }

func scan(path string, o scanOpts, fn func(osm.Object)) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	s := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(-1))
	defer s.Close()
	if !o.nodes {
		s.FilterNode = func(*osm.Node) bool { return false }
	}
	if !o.ways {
		s.FilterWay = func(*osm.Way) bool { return false }
	}
	if !o.rels {
		s.FilterRelation = func(*osm.Relation) bool { return false }
	}
	for s.Scan() {
		fn(s.Object())
	}
	return s.Err()
}

func mdeg(v float64) int32 { return int32(math.Round(v * micro)) }

// hebrewNames lists the Hebrew-bearing name variants of an element, primary first.
func hebrewNames(t osm.Tags, keys ...string) []string {
	var out []string
	seen := map[string]bool{}
	for _, k := range keys {
		v := t.Find(k)
		if v == "" {
			continue
		}
		for _, part := range strings.Split(v, ";") {
			part = strings.TrimSpace(part)
			if part == "" || !HasHebrew(part) || seen[part] {
				continue
			}
			seen[part] = true
			out = append(out, part)
		}
	}
	return out
}

var nameKeys = []string{"name:he", "name", "official_name:he", "official_name", "old_name:he", "old_name", "alt_name:he", "alt_name", "short_name:he", "short_name"}

func anyNames(t osm.Tags) []string {
	var out []string
	for _, k := range []string{"name:he", "name", "official_name", "old_name", "alt_name", "name:en", "name:ar"} {
		if v := t.Find(k); v != "" {
			out = append(out, v)
		}
	}
	return out
}

type admin struct {
	names    []string
	regional bool
	outer    []int64
	inner    []int64
}

type streetWay struct {
	names []string
	nodes []int32
}
type addrRec struct {
	street, hn, city string
	lat, lon         int32
	nodes            []int32 // for building ways (centroid computed later)
}
type poiRec struct {
	names    []string
	lat, lon int32
	nodes    []int32
}
type brandRec struct {
	brands, names []string
	lat, lon      int32
	nodes         []int32
}
type placeRec struct {
	names    []string
	lat, lon float64
}

var skipHighway = map[string]bool{"steps": true, "corridor": true, "proposed": true, "construction": true, "raceway": true, "elevator": true, "platform": true}

func isPOITags(t osm.Tags) bool {
	switch {
	case t.Find("shop") == "mall" || t.Find("shop") == "department_store":
	case t.Find("amenity") == "marketplace":
	case t.Find("landuse") == "retail" || t.Find("landuse") == "commercial" || t.Find("landuse") == "industrial":
	case t.Find("building") == "retail" || t.Find("building") == "commercial":
	default:
		return false
	}
	return true
}

func isBrandTags(t osm.Tags) bool {
	s := t.Find("shop")
	return s == "supermarket" || s == "convenience" || s == "greengrocer" || s == "wholesale"
}

// Build reads an OSM PBF extract and returns the index.
func Build(pbfPath string) (*Index, error) {
	// ---- pass 1: municipal boundary relations
	admins := map[int64]*admin{}
	bways := map[int64]bool{}
	err := scan(pbfPath, scanOpts{rels: true}, func(o osm.Object) {
		r, ok := o.(*osm.Relation)
		if !ok || r.Tags.Find("boundary") != "administrative" || r.Tags.Find("admin_level") != "8" {
			return
		}
		a := &admin{names: anyNames(r.Tags)}
		if len(a.names) == 0 {
			return
		}
		a.regional = strings.Contains(r.Tags.Find("name"), "מועצה אזורית") || strings.Contains(r.Tags.Find("name:he"), "מועצה אזורית")
		for _, m := range r.Members {
			if m.Type != osm.TypeWay {
				continue
			}
			switch m.Role {
			case "inner":
				a.inner = append(a.inner, m.Ref)
			case "outer", "":
				a.outer = append(a.outer, m.Ref)
			default:
				continue
			}
			bways[m.Ref] = true
		}
		admins[int64(r.ID)] = a
	})
	if err != nil {
		return nil, err
	}

	// ---- pass 2: ways
	need := map[osm.NodeID]int32{}
	var ncoord int32
	idx := func(id osm.NodeID) int32 {
		i, ok := need[id]
		if !ok {
			i = ncoord
			ncoord++
			need[id] = i
		}
		return i
	}
	idxs := func(w *osm.Way) []int32 {
		out := make([]int32, len(w.Nodes))
		for i, n := range w.Nodes {
			out[i] = idx(n.ID)
		}
		return out
	}
	bwNodes := map[int64][]osm.NodeID{}
	var streets []streetWay
	var addrWays []addrRec
	var poiWays []poiRec
	var brandWays []brandRec
	err = scan(pbfPath, scanOpts{ways: true}, func(o osm.Object) {
		w, ok := o.(*osm.Way)
		if !ok {
			return
		}
		t := w.Tags
		if bways[int64(w.ID)] {
			ids := w.Nodes.NodeIDs()
			bwNodes[int64(w.ID)] = ids
			for _, id := range ids {
				idx(id)
			}
		}
		if hw := t.Find("highway"); hw != "" && !skipHighway[hw] {
			if names := hebrewNames(t, nameKeys...); len(names) > 0 {
				streets = append(streets, streetWay{names, idxs(w)})
			}
		}
		if hn, st := t.Find("addr:housenumber"), t.Find("addr:street"); hn != "" && st != "" && HasHebrew(st) {
			addrWays = append(addrWays, addrRec{street: st, hn: hn, city: t.Find("addr:city"), nodes: idxs(w)})
		}
		if isPOITags(t) {
			if names := hebrewNames(t, nameKeys...); len(names) > 0 {
				poiWays = append(poiWays, poiRec{names: names, nodes: idxs(w)})
			}
		}
		if isBrandTags(t) {
			if b := brandRecOf(t); b != nil {
				b.nodes = idxs(w)
				brandWays = append(brandWays, *b)
			}
		}
	})
	if err != nil {
		return nil, err
	}

	// ---- pass 3: nodes
	lat := make([]int32, ncoord)
	lon := make([]int32, ncoord)
	var addrNodes []addrRec
	var poiNodes []poiRec
	var brandNodes []brandRec
	var places []placeRec
	err = scan(pbfPath, scanOpts{nodes: true}, func(o osm.Object) {
		n, ok := o.(*osm.Node)
		if !ok {
			return
		}
		if i, ok := need[n.ID]; ok {
			lat[i], lon[i] = mdeg(n.Lat), mdeg(n.Lon)
		}
		if len(n.Tags) == 0 {
			return
		}
		t := n.Tags
		if hn, st := t.Find("addr:housenumber"), t.Find("addr:street"); hn != "" && st != "" && HasHebrew(st) {
			addrNodes = append(addrNodes, addrRec{street: st, hn: hn, city: t.Find("addr:city"), lat: mdeg(n.Lat), lon: mdeg(n.Lon)})
		}
		switch t.Find("place") {
		case "city", "town", "village", "hamlet":
			if names := hebrewNames(t, nameKeys...); len(names) > 0 {
				places = append(places, placeRec{names, n.Lat, n.Lon})
			}
		}
		if isPOITags(t) {
			if names := hebrewNames(t, nameKeys...); len(names) > 0 {
				poiNodes = append(poiNodes, poiRec{names: names, lat: mdeg(n.Lat), lon: mdeg(n.Lon)})
			}
		}
		if isBrandTags(t) {
			if b := brandRecOf(t); b != nil {
				b.lat, b.lon = mdeg(n.Lat), mdeg(n.Lon)
				brandNodes = append(brandNodes, *b)
			}
		}
	})
	if err != nil {
		return nil, err
	}

	// ---- cities: municipal polygons, then place nodes
	bd := NewBoundaries()
	b := &builder{lat: lat, lon: lon, nameToCity: map[string][]int32{}}
	ids := make([]int64, 0, len(admins))
	for id := range admins {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	coordsOf := func(ring []int64) []ptf {
		out := make([]ptf, 0, len(ring))
		for _, id := range ring {
			i, ok := need[osm.NodeID(id)]
			if !ok || lat[i] == 0 {
				return nil
			}
			out = append(out, ptf{deg(lon[i]), deg(lat[i])})
		}
		return out
	}
	rings := func(ways []int64) [][]ptf {
		var segs [][]int64
		for _, w := range ways {
			if n := bwNodes[w]; len(n) > 1 {
				s := make([]int64, len(n))
				for i, v := range n {
					s[i] = int64(v)
				}
				segs = append(segs, s)
			}
		}
		var out [][]ptf
		for _, r := range stitch(segs) {
			if c := coordsOf(r); c != nil {
				out = append(out, c)
			}
		}
		return out
	}
	for _, id := range ids {
		a := admins[id]
		outers, inners := rings(a.outer), rings(a.inner)
		if len(outers) == 0 {
			continue
		}
		largest := outers[0]
		for _, r := range outers {
			if len(r) > len(largest) {
				largest = r
			}
		}
		clat, clon := RingCentroid(largest)
		cid := int32(len(b.cities))
		c := City{Lat: mdeg(clat), Lon: mdeg(clon)}
		b.cities = append(b.cities, c)
		b.regional = append(b.regional, a.regional)
		b.isPlace = append(b.isPlace, false)
		for _, n := range a.names {
			b.addCityName(cid, n)
		}
		if h := hebrewNames(osm.Tags{{Key: "name", Value: strings.Join(a.names, ";")}}, "name"); len(h) > 0 {
			b.cities[cid].Name = h[0]
		} else {
			b.cities[cid].Name = a.names[0]
		}
		bd.Add(cid, outers, inners)
	}
	bd.Build()
	b.bd = bd
	for _, p := range places {
		merged := false
		if pid, ok := bd.Find(p.lat, p.lon); ok && !b.regional[pid] {
			for _, n := range p.names {
				if b.cityHasName(pid, n) {
					for _, m := range p.names {
						b.addCityName(pid, m)
					}
					b.cities[pid].Lat, b.cities[pid].Lon = mdeg(p.lat), mdeg(p.lon)
					b.isPlace[pid] = true
					merged = true
					break
				}
			}
		}
		if merged {
			continue
		}
		cid := int32(len(b.cities))
		b.cities = append(b.cities, City{Name: p.names[0], Lat: mdeg(p.lat), Lon: mdeg(p.lon)})
		b.regional = append(b.regional, false)
		b.isPlace = append(b.isPlace, true)
		for _, n := range p.names {
			b.addCityName(cid, n)
		}
	}
	for i := range b.cities {
		b.cities[i].Names = b.cityNames[int32(i)]
	}
	b.placeIDs = nil
	for i, p := range b.isPlace {
		if p {
			b.placeIDs = append(b.placeIDs, int32(i))
		}
	}

	// ---- streets
	b.streets = map[streetKey]*bStreet{}
	b.alias = map[streetKey]*bStreet{}
	for _, w := range streets {
		primary := NormStreet(w.names[0])
		if primary == "" {
			continue
		}
		for c, pts := range b.splitByCity(w.nodes) {
			s := b.street(c, primary)
			s.pts = append(s.pts, pts...)
			for _, alt := range w.names[1:] {
				if n := NormStreet(alt); n != "" && n != primary {
					k := streetKey{c, n}
					if _, isPrimary := b.streets[k]; !isPrimary {
						b.alias[k] = s
						s.addName(n)
					}
				}
			}
		}
	}
	addAddr := func(r addrRec, la, lo int32) {
		name := NormStreet(r.street)
		if name == "" {
			return
		}
		c := b.cityOf(deg(la), deg(lo), r.city)
		if c < 0 {
			return
		}
		s := b.lookupOrMake(c, name)
		for _, h := range ParseHouseNumbers(r.hn) {
			s.houses = append(s.houses, House{Num: int32(h.N), Suf: h.Suf, Lat: la, Lon: lo})
		}
	}
	for _, r := range addrNodes {
		addAddr(r, r.lat, r.lon)
	}
	for _, r := range addrWays {
		if la, lo, ok := b.centroid(r.nodes); ok {
			addAddr(r, mdeg(la), mdeg(lo))
		}
	}

	ix := &Index{Cities: b.cities}
	keys := make([]streetKey, 0, len(b.streets))
	for k := range b.streets {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].city != keys[j].city {
			return keys[i].city < keys[j].city
		}
		return keys[i].name < keys[j].name
	})
	for _, k := range keys {
		if st, ok := b.streets[k].finish(k.city); ok {
			ix.Streets = append(ix.Streets, st)
		}
	}

	// ---- POIs
	seenPOI := map[streetKey]bool{}
	addPOI := func(r poiRec) {
		la, lo := r.lat, r.lon
		if len(r.nodes) > 0 {
			la32, lo32, ok2 := b.centroid(r.nodes)
			if !ok2 {
				return
			}
			la, lo = mdeg(la32), mdeg(lo32)
		}
		c := b.cityOf(deg(la), deg(lo), "")
		if c < 0 {
			return
		}
		for _, n := range r.names {
			k := NormPOI(n)
			if k == "" || seenPOI[streetKey{c, k}] {
				continue
			}
			seenPOI[streetKey{c, k}] = true
			ix.POIs = append(ix.POIs, POI{City: c, Name: k, Lat: la, Lon: lo})
		}
	}
	for _, r := range poiNodes {
		addPOI(r)
	}
	for _, r := range poiWays {
		addPOI(r)
	}
	// ---- brand POIs
	addBrand := func(r brandRec) {
		la, lo := r.lat, r.lon
		if len(r.nodes) > 0 {
			la32, lo32, ok := b.centroid(r.nodes)
			if !ok {
				return
			}
			la, lo = mdeg(la32), mdeg(lo32)
		}
		c := b.cityOf(deg(la), deg(lo), "")
		if c < 0 {
			return
		}
		for _, br := range r.brands {
			ix.Brands = append(ix.Brands, Brand{City: c, Brand: br, Name: NormStreet(r.names[0]), Lat: la, Lon: lo})
			break
		}
	}
	for _, r := range brandNodes {
		addBrand(r)
	}
	for _, r := range brandWays {
		addBrand(r)
	}
	sort.SliceStable(ix.POIs, func(i, j int) bool { return ix.POIs[i].City < ix.POIs[j].City })
	sort.SliceStable(ix.Brands, func(i, j int) bool { return ix.Brands[i].City < ix.Brands[j].City })
	ix.Prepare()
	return ix, nil
}

// brandRecOf extracts brand / name keys of a shop; nil when it has no Hebrew name or brand.
func brandRecOf(t osm.Tags) *brandRec {
	names := hebrewNames(t, "name:he", "name", "brand:he", "brand")
	brands := hebrewNames(t, "brand:he", "brand", "name:he", "name")
	if len(names) == 0 || len(brands) == 0 {
		return nil
	}
	r := &brandRec{names: names}
	for _, b := range brands {
		r.brands = append(r.brands, NormStreet(b))
	}
	return r
}

type bStreet struct {
	names  []string
	pts    []int32 // lat,lon pairs
	houses []House
}

func (s *bStreet) addName(n string) {
	for _, e := range s.names {
		if e == n {
			return
		}
	}
	s.names = append(s.names, n)
}

type builder struct {
	lat, lon   []int32
	cities     []City
	cityNames  map[int32][]string
	nameToCity map[string][]int32
	regional   []bool
	isPlace    []bool
	placeIDs   []int32
	bd         *Boundaries
	streets    map[streetKey]*bStreet
	alias      map[streetKey]*bStreet
}

func (b *builder) addCityName(cid int32, raw string) {
	n := NormCity(raw)
	if n == "" {
		return
	}
	if b.cityNames == nil {
		b.cityNames = map[int32][]string{}
	}
	add := func(n string) {
		for _, e := range b.cityNames[cid] {
			if e == n {
				return
			}
		}
		b.cityNames[cid] = append(b.cityNames[cid], n)
		b.nameToCity[n] = append(b.nameToCity[n], cid)
	}
	add(n)
	if strings.HasSuffix(n, " יפו") {
		add(strings.TrimSuffix(n, " יפו"))
	}
	if strings.HasPrefix(n, "מועצה אזורית ") {
		add(strings.TrimPrefix(n, "מועצה אזורית "))
	}
}

func (b *builder) cityHasName(cid int32, raw string) bool {
	n := NormCity(raw)
	for _, e := range b.cityNames[cid] {
		if e == n {
			return true
		}
	}
	return false
}

func (b *builder) street(c int32, name string) *bStreet {
	k := streetKey{c, name}
	s := b.streets[k]
	if s == nil {
		s = &bStreet{names: []string{name}}
		b.streets[k] = s
	}
	return s
}

func (b *builder) lookupOrMake(c int32, name string) *bStreet {
	k := streetKey{c, name}
	if s := b.streets[k]; s != nil {
		return s
	}
	if s := b.alias[k]; s != nil {
		return s
	}
	return b.street(c, name)
}

// centroid is the mean of way nodes.
func (b *builder) centroid(nodes []int32) (lat, lon float64, ok bool) {
	var sa, so float64
	n := 0
	for _, i := range nodes {
		if b.lat[i] != 0 {
			sa += float64(b.lat[i])
			so += float64(b.lon[i])
			n++
		}
	}
	if n == 0 {
		return 0, 0, false
	}
	return sa / float64(n) / micro, so / float64(n) / micro, true
}

// cityOf: municipal polygon, else addr:city, else nearest place node, else the regional council.
func (b *builder) cityOf(lat, lon float64, hint string) int32 {
	pid, inPoly := b.bd.Find(lat, lon)
	if inPoly && !b.regional[pid] {
		return pid
	}
	if hint != "" {
		best, bd := int32(-1), 30.0
		for _, c := range b.nameToCity[NormCity(hint)] {
			if d := kmBetween(lat, lon, deg(b.cities[c].Lat), deg(b.cities[c].Lon)); d < bd {
				best, bd = c, d
			}
		}
		if best >= 0 {
			return best
		}
	}
	best, bd := int32(-1), 10.0
	for _, c := range b.placeIDs {
		dy := (lat - deg(b.cities[c].Lat)) * 111.0
		if dy > bd || dy < -bd {
			continue
		}
		dx := (lon - deg(b.cities[c].Lon)) * 111.0 * math.Cos(lat*math.Pi/180)
		if d := math.Hypot(dx, dy); d < bd {
			best, bd = c, d
		}
	}
	if best >= 0 {
		return best
	}
	if inPoly {
		return pid
	}
	return -1
}

// splitByCity groups way nodes by municipality; most ways are inside one city, which three
// probes detect without testing every node.
func (b *builder) splitByCity(nodes []int32) map[int32][]int32 {
	out := map[int32][]int32{}
	pt := func(i int32) (float64, float64) { return deg(b.lat[i]), deg(b.lon[i]) }
	valid := make([]int32, 0, len(nodes))
	for _, i := range nodes {
		if b.lat[i] != 0 {
			valid = append(valid, i)
		}
	}
	if len(valid) == 0 {
		return out
	}
	flat := func(ns []int32) []int32 {
		r := make([]int32, 0, 2*len(ns))
		for _, i := range ns {
			r = append(r, b.lat[i], b.lon[i])
		}
		return r
	}
	a1, o1 := pt(valid[0])
	a2, o2 := pt(valid[len(valid)/2])
	a3, o3 := pt(valid[len(valid)-1])
	c1, c2, c3 := b.cityOf(a1, o1, ""), b.cityOf(a2, o2, ""), b.cityOf(a3, o3, "")
	if c1 == c2 && c2 == c3 {
		if c1 >= 0 {
			out[c1] = flat(valid)
		}
		return out
	}
	for _, i := range valid {
		a, o := pt(i)
		if c := b.cityOf(a, o, ""); c >= 0 {
			out[c] = append(out[c], b.lat[i], b.lon[i])
		}
	}
	return out
}

// finish picks the representative point and dedups house numbers.
func (s *bStreet) finish(city int32) (Street, bool) {
	st := Street{City: city, Names: s.names}
	pts := s.pts
	if len(pts) == 0 {
		for _, h := range s.houses {
			pts = append(pts, h.Lat, h.Lon)
		}
	}
	if len(pts) == 0 {
		return st, false
	}
	var sa, so float64
	n := len(pts) / 2
	for i := 0; i < n; i++ {
		sa += float64(pts[2*i])
		so += float64(pts[2*i+1])
	}
	ca, co := sa/float64(n), so/float64(n)
	bd := math.MaxFloat64
	for i := 0; i < n; i++ {
		da, do := float64(pts[2*i])-ca, (float64(pts[2*i+1])-co)*0.85
		if d := da*da + do*do; d < bd {
			bd = d
			st.Lat, st.Lon = pts[2*i], pts[2*i+1]
		}
	}
	sort.SliceStable(s.houses, func(i, j int) bool {
		if s.houses[i].Num != s.houses[j].Num {
			return s.houses[i].Num < s.houses[j].Num
		}
		return s.houses[i].Suf < s.houses[j].Suf
	})
	for _, h := range s.houses {
		if l := len(st.Houses); l > 0 && st.Houses[l-1].Num == h.Num && st.Houses[l-1].Suf == h.Suf {
			continue
		}
		st.Houses = append(st.Houses, h)
	}
	return st, true
}

// HouseNum is one parsed house number: 12 or 12א.
type HouseNum struct {
	N   int
	Suf string
}

// ParseHouseNumbers reads an OSM addr:housenumber value: "12", "12א", "12;14", "12-14", "3/5".
func ParseHouseNumbers(s string) []HouseNum {
	var out []HouseNum
	for _, part := range strings.FieldsFunc(s, func(r rune) bool { return r == ';' || r == ',' || r == '-' || r == '–' }) {
		part = strings.TrimSpace(part)
		i := 0
		for i < len(part) && part[i] >= '0' && part[i] <= '9' {
			i++
		}
		if i == 0 {
			continue
		}
		n, err := strconv.Atoi(part[:i])
		if err != nil || n <= 0 || n > 99999 {
			continue
		}
		suf := ""
		if rest := strings.TrimSpace(part[i:]); rest != "" && !strings.HasPrefix(rest, "/") {
			if r := []rune(strings.ToLower(rest)); len(r) == 1 {
				suf = string(r)
			}
		}
		out = append(out, HouseNum{n, suf})
	}
	return out
}

// Stats summarises the index for logging.
func (ix *Index) Stats() string {
	h := 0
	for _, s := range ix.Streets {
		h += len(s.Houses)
	}
	return fmt.Sprintf("%d cities, %d streets, %d house numbers, %d POIs, %d brand POIs", len(ix.Cities), len(ix.Streets), h, len(ix.POIs), len(ix.Brands))
}
