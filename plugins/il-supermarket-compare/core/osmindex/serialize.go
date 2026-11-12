package osmindex

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sort"
)

// File format (all inside one gzip stream): magic "ILOI", version byte, then varint-coded
// string table, cities, streets (sorted by city; points delta-coded), POIs and brands.

const (
	magic   = "ILOI"
	version = 2
)

type wbuf struct {
	b    bytes.Buffer
	strs map[string]int
	list []string
}

func (w *wbuf) u(v uint64) {
	var t [10]byte
	w.b.Write(t[:binary.PutUvarint(t[:], v)])
}
func (w *wbuf) i(v int64) {
	var t [10]byte
	w.b.Write(t[:binary.PutVarint(t[:], v)])
}
func (w *wbuf) s(v string) {
	id, ok := w.strs[v]
	if !ok {
		id = len(w.list)
		w.strs[v] = id
		w.list = append(w.list, v)
	}
	w.u(uint64(id))
}

// Write serialises the index as a gzip'd compact binary.
func (ix *Index) Write(out io.Writer) error {
	w := &wbuf{strs: map[string]int{}}
	w.u(uint64(len(ix.Cities)))
	for _, c := range ix.Cities {
		w.s(c.Name)
		w.u(uint64(len(c.Names)))
		for _, n := range c.Names {
			w.s(n)
		}
		w.i(int64(c.Lat))
		w.i(int64(c.Lon))
	}
	order := make([]int, len(ix.Streets))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return ix.Streets[order[a]].City < ix.Streets[order[b]].City })
	w.u(uint64(len(order)))
	var pc, pla, plo int32
	for _, oi := range order {
		s := ix.Streets[oi]
		w.u(uint64(s.City - pc))
		pc = s.City
		w.u(uint64(len(s.Names)))
		for _, n := range s.Names {
			w.s(n)
		}
		w.i(int64(s.Lat - pla))
		w.i(int64(s.Lon - plo))
		pla, plo = s.Lat, s.Lon
		w.u(uint64(len(s.Houses)))
		var pn, hla, hlo int32 = 0, s.Lat, s.Lon
		for _, h := range s.Houses {
			w.u(uint64(h.Num - pn))
			pn = h.Num
			if h.Suf == "" {
				w.u(0)
			} else {
				w.u(1)
				w.s(h.Suf)
			}
			w.i(int64(h.Lat - hla))
			w.i(int64(h.Lon - hlo))
			hla, hlo = h.Lat, h.Lon
		}
	}
	w.u(uint64(len(ix.POIs)))
	for _, p := range ix.POIs {
		w.u(uint64(p.City))
		w.s(p.Name)
		w.i(int64(p.Lat))
		w.i(int64(p.Lon))
	}
	w.u(uint64(len(ix.Brands)))
	for _, p := range ix.Brands {
		w.u(uint64(p.City))
		w.s(p.Brand)
		w.s(p.Name)
		w.i(int64(p.Lat))
		w.i(int64(p.Lon))
	}

	gz, err := gzip.NewWriterLevel(out, gzip.BestCompression)
	if err != nil {
		return err
	}
	bw := bufio.NewWriter(gz)
	bw.WriteString(magic)
	bw.WriteByte(version)
	var t [10]byte
	bw.Write(t[:binary.PutUvarint(t[:], uint64(len(w.list)))])
	for _, s := range w.list {
		bw.Write(t[:binary.PutUvarint(t[:], uint64(len(s)))])
		bw.WriteString(s)
	}
	bw.Write(w.b.Bytes())
	if err := bw.Flush(); err != nil {
		return err
	}
	return gz.Close()
}

type rbuf struct {
	r    *bufio.Reader
	strs []string
	err  error
}

func (r *rbuf) u() uint64 {
	v, err := binary.ReadUvarint(r.r)
	if err != nil && r.err == nil {
		r.err = err
	}
	return v
}
func (r *rbuf) i() int64 {
	v, err := binary.ReadVarint(r.r)
	if err != nil && r.err == nil {
		r.err = err
	}
	return v
}
func (r *rbuf) s() string {
	id := r.u()
	if id >= uint64(len(r.strs)) {
		if r.err == nil {
			r.err = errors.New("osmindex: bad string id")
		}
		return ""
	}
	return r.strs[id]
}

// Load reads an index written by Write.
func Load(in io.Reader) (*Index, error) {
	gz, err := gzip.NewReader(in)
	if err != nil {
		return nil, err
	}
	defer gz.Close()
	r := &rbuf{r: bufio.NewReaderSize(gz, 1<<20)}
	hdr := make([]byte, len(magic)+1)
	if _, err := io.ReadFull(r.r, hdr); err != nil {
		return nil, err
	}
	if string(hdr[:len(magic)]) != magic || hdr[len(magic)] != version {
		return nil, fmt.Errorf("osmindex: unsupported file (header %q)", hdr)
	}
	ns := r.u()
	if r.err != nil || ns > 1<<26 {
		return nil, errors.New("osmindex: corrupt string table")
	}
	r.strs = make([]string, ns)
	for i := range r.strs {
		n := r.u()
		if r.err != nil || n > 1<<20 {
			return nil, errors.New("osmindex: corrupt string")
		}
		b := make([]byte, n)
		if _, err := io.ReadFull(r.r, b); err != nil {
			return nil, err
		}
		r.strs[i] = string(b)
	}
	ix := &Index{}
	nc := r.u()
	if r.err != nil || nc > 1<<24 {
		return nil, errors.New("osmindex: corrupt cities")
	}
	ix.Cities = make([]City, nc)
	for i := range ix.Cities {
		c := &ix.Cities[i]
		c.Name = r.s()
		for k := r.u(); k > 0 && r.err == nil; k-- {
			c.Names = append(c.Names, r.s())
		}
		c.Lat, c.Lon = int32(r.i()), int32(r.i())
	}
	nst := r.u()
	if r.err != nil || nst > 1<<26 {
		return nil, errors.New("osmindex: corrupt streets")
	}
	ix.Streets = make([]Street, nst)
	var pc, pla, plo int32
	for i := range ix.Streets {
		s := &ix.Streets[i]
		pc += int32(r.u())
		s.City = pc
		for k := r.u(); k > 0 && r.err == nil; k-- {
			s.Names = append(s.Names, r.s())
		}
		pla += int32(r.i())
		plo += int32(r.i())
		s.Lat, s.Lon = pla, plo
		nh := r.u()
		if r.err != nil || nh > 1<<24 {
			return nil, errors.New("osmindex: corrupt houses")
		}
		s.Houses = make([]House, nh)
		var pn, hla, hlo int32 = 0, s.Lat, s.Lon
		for k := range s.Houses {
			h := &s.Houses[k]
			pn += int32(r.u())
			h.Num = pn
			if r.u() == 1 {
				h.Suf = r.s()
			}
			hla += int32(r.i())
			hlo += int32(r.i())
			h.Lat, h.Lon = hla, hlo
		}
	}
	np := r.u()
	if r.err != nil || np > 1<<24 {
		return nil, errors.New("osmindex: corrupt pois")
	}
	ix.POIs = make([]POI, np)
	for i := range ix.POIs {
		p := &ix.POIs[i]
		p.City = int32(r.u())
		p.Name = r.s()
		p.Lat, p.Lon = int32(r.i()), int32(r.i())
	}
	nb := r.u()
	if r.err != nil || nb > 1<<24 {
		return nil, errors.New("osmindex: corrupt brands")
	}
	ix.Brands = make([]Brand, nb)
	for i := range ix.Brands {
		p := &ix.Brands[i]
		p.City = int32(r.u())
		p.Brand = r.s()
		p.Name = r.s()
		p.Lat, p.Lon = int32(r.i()), int32(r.i())
	}
	if r.err != nil {
		return nil, r.err
	}
	for _, s := range ix.Streets {
		if int(s.City) >= len(ix.Cities) {
			return nil, errors.New("osmindex: street city out of range")
		}
	}
	for _, p := range ix.POIs {
		if int(p.City) >= len(ix.Cities) {
			return nil, errors.New("osmindex: poi city out of range")
		}
	}
	for _, p := range ix.Brands {
		if int(p.City) >= len(ix.Cities) {
			return nil, errors.New("osmindex: brand city out of range")
		}
	}
	ix.Prepare()
	return ix, nil
}
