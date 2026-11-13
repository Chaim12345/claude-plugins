package osmindex

import (
	"math"
	"sort"
)

// A Boundaries set answers "which municipality contains this point?" with a coarse grid over
// polygon bounding boxes and an exact ray-casting test.

type ptf = [2]float64 // lon, lat

type boundary struct {
	id             int32
	minLat, maxLat float64
	minLon, maxLon float64
	area           float64
	outers         [][]ptf
	inners         [][]ptf
}

const gridCell = 0.02 // degrees, ~2 km

type Boundaries struct {
	polys []boundary
	grid  map[[2]int32][]int32
}

func cellOf(lat, lon float64) [2]int32 {
	return [2]int32{int32(math.Floor(lat / gridCell)), int32(math.Floor(lon / gridCell))}
}

// NewBoundaries builds the lookup. id is whatever the caller wants returned by Find.
func NewBoundaries() *Boundaries { return &Boundaries{grid: map[[2]int32][]int32{}} }

// Add registers a (multi)polygon given as outer and inner rings.
func (b *Boundaries) Add(id int32, outers, inners [][]ptf) {
	if len(outers) == 0 {
		return
	}
	p := boundary{id: id, outers: outers, inners: inners, minLat: 90, minLon: 180, maxLat: -90, maxLon: -180}
	for _, r := range outers {
		for _, q := range r {
			p.minLon = math.Min(p.minLon, q[0])
			p.maxLon = math.Max(p.maxLon, q[0])
			p.minLat = math.Min(p.minLat, q[1])
			p.maxLat = math.Max(p.maxLat, q[1])
		}
	}
	for _, r := range outers {
		p.area += math.Abs(ringArea(r))
	}
	for _, r := range inners {
		p.area -= math.Abs(ringArea(r))
	}
	b.polys = append(b.polys, p)
}

// Build must be called after the last Add.
func (b *Boundaries) Build() {
	// smaller polygons first so the first hit in a cell is the most specific
	sort.SliceStable(b.polys, func(i, j int) bool { return b.polys[i].area < b.polys[j].area })
	b.grid = map[[2]int32][]int32{}
	for i, p := range b.polys {
		lo, hi := cellOf(p.minLat, p.minLon), cellOf(p.maxLat, p.maxLon)
		for y := lo[0]; y <= hi[0]; y++ {
			for x := lo[1]; x <= hi[1]; x++ {
				k := [2]int32{y, x}
				b.grid[k] = append(b.grid[k], int32(i))
			}
		}
	}
}

// Find returns the id of the smallest polygon containing the point.
func (b *Boundaries) Find(lat, lon float64) (int32, bool) {
	for _, i := range b.grid[cellOf(lat, lon)] {
		p := &b.polys[i]
		if lat < p.minLat || lat > p.maxLat || lon < p.minLon || lon > p.maxLon {
			continue
		}
		in := false
		for _, r := range p.outers {
			if ringContains(r, lon, lat) {
				in = true
				break
			}
		}
		if !in {
			continue
		}
		hole := false
		for _, r := range p.inners {
			if ringContains(r, lon, lat) {
				hole = true
				break
			}
		}
		if !hole {
			return p.id, true
		}
	}
	return 0, false
}

func ringContains(r []ptf, x, y float64) bool {
	in := false
	for i, j := 0, len(r)-1; i < len(r); j, i = i, i+1 {
		a, c := r[i], r[j]
		if (a[1] > y) != (c[1] > y) && x < (c[0]-a[0])*(y-a[1])/(c[1]-a[1])+a[0] {
			in = !in
		}
	}
	return in
}

func ringArea(r []ptf) float64 {
	s := 0.0
	for i, j := 0, len(r)-1; i < len(r); j, i = i, i+1 {
		s += r[j][0]*r[i][1] - r[i][0]*r[j][1]
	}
	return s / 2
}

// RingCentroid is the area centroid of a ring (falls back to the vertex mean).
func RingCentroid(r []ptf) (lat, lon float64) {
	a := ringArea(r)
	if math.Abs(a) < 1e-12 {
		for _, p := range r {
			lon += p[0]
			lat += p[1]
		}
		n := float64(len(r))
		return lat / n, lon / n
	}
	var cx, cy float64
	for i, j := 0, len(r)-1; i < len(r); j, i = i, i+1 {
		f := r[j][0]*r[i][1] - r[i][0]*r[j][1]
		cx += (r[j][0] + r[i][0]) * f
		cy += (r[j][1] + r[i][1]) * f
	}
	return cy / (6 * a), cx / (6 * a)
}

// stitch joins way segments (node id sequences) into closed rings.
func stitch(segs [][]int64) [][]int64 {
	used := make([]bool, len(segs))
	var rings [][]int64
	for i := range segs {
		if used[i] || len(segs[i]) < 2 {
			continue
		}
		used[i] = true
		ring := append([]int64(nil), segs[i]...)
		for ring[0] != ring[len(ring)-1] {
			end := ring[len(ring)-1]
			found := false
			for j := range segs {
				if used[j] || len(segs[j]) < 2 {
					continue
				}
				s := segs[j]
				switch {
				case s[0] == end:
					ring = append(ring, s[1:]...)
				case s[len(s)-1] == end:
					for k := len(s) - 2; k >= 0; k-- {
						ring = append(ring, s[k])
					}
				default:
					continue
				}
				used[j] = true
				found = true
				break
			}
			if !found {
				break
			}
		}
		if len(ring) >= 4 && ring[0] == ring[len(ring)-1] {
			rings = append(rings, ring)
		}
	}
	return rings
}
