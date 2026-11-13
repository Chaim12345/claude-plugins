// Package shop is the app's domain logic in Go: products, unit prices, search, deals and the basket
// comparison, read from a core.Catalog. It is what the Go-rendered UI (package ui) shows. It mirrors
// the app's TypeScript (mobile/src/lib) so both give the same answers.
package shop

import (
	"math"
	"strconv"
	"strings"
	"unicode"
)

// UnitKind is what a unit price is per: 100 g, 1 L or one piece.
type UnitKind int

const (
	Weight UnitKind = iota
	Volume
	Count
)

// Size is a pack: Amount is the TOTAL in grams, millilitres or pieces; Packs is how many identical packs.
type Size struct {
	Kind   UnitKind
	Amount float64
	Packs  int
}

// UnitPrice is agorot per 100 g (Weight), per litre (Volume) or per piece (Count).
type UnitPrice struct {
	Kind   UnitKind
	Agorot float64
}

var base = map[UnitKind]float64{Weight: 100, Volume: 1000, Count: 1}

type unitWord struct {
	w      string
	kind   UnitKind
	factor float64
	strong bool // may be glued to the next word ("גרםטירת"); weak ones must end the token
}

var units = func() []unitWord {
	u := []unitWord{
		{"קילוגרם", Weight, 1000, true}, {"גרמים", Weight, 1, true}, {"גרם", Weight, 1, true},
		{"מיליליטר", Volume, 1, true}, {"ליטרים", Volume, 1000, true}, {"ליטר", Volume, 1000, true},
		{"קילו", Weight, 1000, false}, {"קג", Weight, 1000, false}, {"kg", Weight, 1000, false},
		{"גר", Weight, 1, false}, {"gr", Weight, 1, false}, {"g", Weight, 1, false}, {"ג", Weight, 1, false},
		{"ליט", Volume, 1000, false}, {"l", Volume, 1000, false}, {"ל", Volume, 1000, false},
		{"מל", Volume, 1, false}, {"ml", Volume, 1, false},
	}
	// longest first, as the TypeScript alternation
	for i := 1; i < len(u); i++ {
		for j := i; j > 0 && len([]rune(u[j].w)) > len([]rune(u[j-1].w)); j-- {
			u[j], u[j-1] = u[j-1], u[j]
		}
	}
	return u
}()

var countWords = []string{"יחידות", "יחידה", "יחי", "יח", "שקיקים", "גלילים", "טיטולים", "חיתולים", "קפסולות", "כוסות", "מגבונים", "תחבושות", "כפפות"}
var metreContext = []string{"גליל", "רול", "ניילון", "נייר", "סרט", "שקית", "מטר", "רצועות"}
var nutrients = []string{"חלבון", "שומן", "סוכר", "פחמימות", "קלוריות", "מלח", "סיבים", "ויטמין"}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }
func isSpace(r rune) bool { return unicode.IsSpace(r) }

func normalize(name string) []rune {
	var b []rune
	for _, r := range name {
		switch r {
		case '"', '\'', '`', '״', '׳', '”', '“', '’', '‘':
			continue
		case '×', '*':
			r = 'x'
		}
		b = append(b, unicode.ToLower(r))
	}
	// "1,5" -> "1.5" (one or two decimals, not a thousands comma)
	for i := 1; i+1 < len(b); i++ {
		if b[i] == ',' && isDigit(b[i-1]) && isDigit(b[i+1]) {
			n := 0
			for j := i + 1; j < len(b) && isDigit(b[j]); j++ {
				n++
			}
			if n <= 2 {
				b[i] = '.'
			}
		}
	}
	return b
}

func hasPrefix(s []rune, i int, w string) bool {
	wr := []rune(w)
	if i+len(wr) > len(s) {
		return false
	}
	for k, r := range wr {
		if s[i+k] != r {
			return false
		}
	}
	return true
}

// number reads \d+(\.\d+)? at i, when i doesn't follow a digit or a dot. Returns value and end.
func number(s []rune, i int) (float64, int, bool) {
	if i >= len(s) || !isDigit(s[i]) || (i > 0 && (isDigit(s[i-1]) || s[i-1] == '.')) {
		return 0, i, false
	}
	j := i
	for j < len(s) && isDigit(s[j]) {
		j++
	}
	if j+1 < len(s) && s[j] == '.' && isDigit(s[j+1]) {
		j++
		for j < len(s) && isDigit(s[j]) {
			j++
		}
	}
	v, err := strconv.ParseFloat(string(s[i:j]), 64)
	return v, j, err == nil
}

func skipSpaces(s []rune, i int) int {
	for i < len(s) && isSpace(s[i]) {
		i++
	}
	return i
}

// unitAt is the unit word at i, honouring the word-boundary rule for weak units.
func unitAt(s []rune, i int, bareM bool) (UnitKind, float64, int, bool) {
	for _, u := range units {
		if !hasPrefix(s, i, u.w) {
			continue
		}
		n := len([]rune(u.w))
		if !u.strong && i+n < len(s) && unicode.IsLetter(s[i+n]) {
			continue
		}
		return u.kind, u.factor, n, true
	}
	if bareM && i < len(s) && s[i] == 'מ' && (i+1 >= len(s) || !unicode.IsLetter(s[i+1])) {
		return Volume, 1, 1, true
	}
	return 0, 0, 0, false
}

// unitText is the unit alternation of the TypeScript regex: the longest unit word at i, no boundary rule.
func unitTextAt(s []rune, i int) int {
	for _, u := range units {
		if hasPrefix(s, i, u.w) {
			return len([]rune(u.w))
		}
	}
	return 0
}

func contains(s []rune, words []string) bool {
	str := string(s)
	for _, w := range words {
		if strings.Contains(str, w) {
			return true
		}
	}
	return false
}

// doubtful: "25 גרם חלבון" is the protein, and "6 1.5 ל" a 6-pack of unknown arrangement.
func doubtful(s []rune, start, end int) bool {
	rest := skipSpaces(s, end)
	for _, n := range nutrients {
		if hasPrefix(s, rest, n) {
			return true
		}
	}
	// the text before start ends with 1-2 digits and whitespace
	j := start
	if j == 0 || !isSpace(s[j-1]) {
		return false
	}
	for j > 0 && isSpace(s[j-1]) {
		j--
	}
	k := j
	for k > 0 && isDigit(s[k-1]) {
		k--
	}
	if j-k < 1 || j-k > 2 || (k > 0 && (isDigit(s[k-1]) || s[k-1] == '.' || s[k-1] == '-')) {
		return false
	}
	lead, _ := strconv.Atoi(string(s[k:j]))
	if lead < 2 || lead > 24 {
		return false
	}
	before := strings.TrimRightFunc(string(s[:k]), unicode.IsSpace)
	return !strings.HasSuffix(before, "שלב") // "שלב 2 700 גרם" is a formula stage
}

func inRange(k UnitKind, amount float64) bool {
	switch k {
	case Count:
		return amount >= 2 && amount <= 1000
	case Weight:
		return amount >= 5 && amount <= 50000
	}
	return amount >= 10 && amount <= 30000
}

// ParseSize reads the pack size from a product name: "חלב 3% 1 ליטר", "טונה 4x160 גרם", "קולה 6x330".
// ok is false when the name has no size, more than one, or one that could be read two ways.
func ParseSize(name, cat string) (Size, bool) {
	s := normalize(name)
	bareM := !contains(s, metreContext)

	// multipacks: 6x330, 6 x 330 מל, 400x3 גרם
	var found []Size
	var consumed [][2]int
	for i := 0; i < len(s); {
		a, aEnd, ok := number(s, i)
		if !ok {
			i++
			continue
		}
		j := skipSpaces(s, aEnd)
		if j >= len(s) || s[j] != 'x' {
			i = aEnd
			continue
		}
		j = skipSpaces(s, j+1)
		b, bEnd, ok := number(s, j)
		if !ok {
			i = aEnd
			continue
		}
		end := skipSpaces(s, bEnd)
		var amount float64
		var packs int
		switch {
		case a == math.Trunc(a) && a >= 2 && a <= 24 && b >= 20:
			packs, amount = int(a), b
		case b == math.Trunc(b) && b >= 2 && b <= 24 && a >= 20:
			packs, amount = int(b), a
		default:
			return Size{}, false
		}
		if k, f, n, ok := unitAt(s, end, bareM); ok {
			found = append(found, Size{k, amount * f * float64(packs), packs})
			consumed = append(consumed, [2]int{i, end + n})
		} else if cat == "drinks" && amount >= 150 && amount <= 750 {
			found = append(found, Size{Volume, amount * float64(packs), packs})
			consumed = append(consumed, [2]int{i, end})
		} else {
			return Size{}, false
		}
		i = end
	}
	if len(found) > 0 {
		if len(found) > 1 {
			return Size{}, false
		}
		rest := append([]rune(nil), s...)
		for _, c := range consumed {
			for k := c[0]; k < c[1] && k < len(rest); k++ {
				rest[k] = ' '
			}
		}
		for i := range rest { // any further plain size makes it ambiguous
			if _, e, ok := number(rest, i); ok && unitTextAt(rest, skipSpaces(rest, e)) > 0 {
				return Size{}, false
			}
		}
		if inRange(found[0].Kind, found[0].Amount) {
			return found[0], true
		}
		return Size{}, false
	}

	// one plain size, optionally followed by "x 6"
	var sizes []Size
	for i := 0; i < len(s); {
		v, e, ok := number(s, i)
		if !ok {
			i++
			continue
		}
		us := skipSpaces(s, e)
		n := unitTextAt(s, us)
		if n == 0 {
			i = e
			continue
		}
		end := us + n
		k, f, _, ok := unitAt(s, us, bareM)
		if ok && !doubtful(s, i, end) {
			packs := 1
			j := skipSpaces(s, end)
			if j < len(s) && s[j] == 'x' {
				j = skipSpaces(s, j+1)
				d := j
				for d < len(s) && isDigit(s[d]) && d-j < 3 {
					d++
				}
				if d > j && d-j <= 2 && (d >= len(s) || (!isDigit(s[d]) && s[d] != '.')) {
					packs, _ = strconv.Atoi(string(s[j:d]))
				}
			}
			sizes = append(sizes, Size{k, v * f * float64(packs), packs})
		}
		i = end
	}
	if len(sizes) == 0 && bareM { // a bare "מ" ("750מ")
		for i := 0; i < len(s); {
			v, e, ok := number(s, i)
			if !ok {
				i++
				continue
			}
			j := skipSpaces(s, e)
			if j < len(s) && s[j] == 'מ' && (j+1 >= len(s) || !unicode.IsLetter(s[j+1])) && v >= 30 && !doubtful(s, i, j+1) {
				sizes = append(sizes, Size{Volume, v, 1})
			}
			i = e
		}
	}
	if len(sizes) > 1 {
		return Size{}, false
	}
	var counts []float64
	for i := 0; i < len(s); {
		v, e, ok := number(s, i)
		if !ok || strings.ContainsRune(string(s[i:e]), '.') || e-i > 4 {
			if ok {
				i = e
			} else {
				i++
			}
			continue
		}
		j := skipSpaces(s, e)
		for _, w := range countWords {
			if hasPrefix(s, j, w) {
				n := len([]rune(w))
				if j+n >= len(s) || !unicode.IsLetter(s[j+n]) {
					counts = append(counts, v)
					break
				}
			}
		}
		i = e
	}
	if len(sizes) == 1 {
		for _, c := range counts {
			if c > 1 {
				return Size{}, false // "125 גר 4 יח": 125 g each or in total?
			}
		}
		if inRange(sizes[0].Kind, sizes[0].Amount) {
			return sizes[0], true
		}
		return Size{}, false
	}
	if len(counts) == 1 && inRange(Count, counts[0]) {
		return Size{Count, counts[0], 1}, true
	}
	return Size{}, false
}

// SizeOf is a product's pack size: the chains' stated size when two or more agree, a multipack spelled
// out in the name, the name's size, or a single chain's figure, in that order (units.ts sizeOf).
func SizeOf(p *Product) (Size, bool) {
	if p.Weighted {
		return Size{}, false
	}
	if p.sizeDone {
		return p.size, p.sizeOK
	}
	name := p.Name
	if p.RawName != "" {
		name = p.RawName
	}
	named, nok := ParseSize(name, p.Cat)
	z, ok := named, nok
	if st := p.StatedSize; st.Amount > 0 {
		stated := Size{st.Kind, st.Amount, 1}
		if nok && named.Kind != Count && stated.Kind != Count && named.Kind != stated.Kind {
			stated.Kind = named.Kind
		}
		switch {
		case nok && named.Packs > 1:
			z, ok = named, true
		case p.StatedAgree >= 2:
			if nok && named.Kind == stated.Kind && math.Abs(named.Amount-stated.Amount) <= 0.02*stated.Amount {
				z = named
			} else {
				z = stated
			}
			ok = true
		case nok:
			z, ok = named, true
		default:
			z, ok = stated, true
		}
	} else if !nok && p.AI != nil && p.AI.S != nil {
		z, ok = p.AI.S.size(), true
	}
	p.size, p.sizeOK, p.sizeDone = z, ok, true
	return z, ok
}

// UnitPriceOf is the unit price of a pack at agorot; ok is false when the size is unknown.
func UnitPriceOf(z Size, ok bool, agorot float64) (UnitPrice, bool) {
	if !ok || agorot <= 0 || z.Amount <= 0 {
		return UnitPrice{}, false
	}
	return UnitPrice{z.Kind, agorot / z.Amount * base[z.Kind]}, true
}

var unitLabel = map[UnitKind]string{Weight: "ל־100 גרם", Volume: "לליטר", Count: "ליחידה"}

// Text: "2.40 ₪ ל־100 גרם".
func (u UnitPrice) Text() string { return Money(u.Agorot) + " ₪ " + unitLabel[u.Kind] }

// Text: "500 גרם", "1.5 ליטר", "6 יחידות".
func (z Size) Text() string {
	n := func(x float64) string { return strconv.FormatFloat(math.Round(x*100)/100, 'f', -1, 64) }
	switch z.Kind {
	case Weight:
		if z.Amount >= 1000 {
			return n(z.Amount/1000) + " ק״ג"
		}
		return n(z.Amount) + " גרם"
	case Volume:
		if z.Amount >= 1000 {
			return n(z.Amount/1000) + " ליטר"
		}
		return n(z.Amount) + " מ״ל"
	}
	return n(z.Amount) + " יחידות"
}

// Money: agorot as shekels with two decimals, "12.90".
func Money(agorot float64) string { return strconv.FormatFloat(math.Round(agorot)/100, 'f', 2, 64) }
