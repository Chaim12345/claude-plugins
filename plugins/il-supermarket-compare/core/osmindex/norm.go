package osmindex

import (
	"strings"
	"unicode"
)

// Normalisation is shared by the index builder and the query side, so a street spelled
// "רח' ז'בוטינסקי" in a store file and "ז׳בוטינסקי" in OpenStreetMap end up with the same key.

// fold lower-cases, drops niqqud, quotes, geresh and gershayim, and turns every other
// non-alphanumeric rune (hyphens, commas, pipes, dots, slashes...) into a space.
func fold(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		switch {
		case r == '"' || r == '\'' || r == '`' || r == '´' || r == '’' || r == '‘' || r == '”' || r == '“' || r == '„' ||
			r == '״' || r == '׳':
			// dropped: ד"ר -> דר, ז'בוטינסקי -> זבוטינסקי
		case r == '־': // maqaf
			b.WriteByte(' ')
		case r >= 0x0591 && r <= 0x05C7: // niqqud and cantillation marks
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		default:
			b.WriteByte(' ')
		}
	}
	return b.String()
}

func isHebrew(r rune) bool { return r >= 0x05D0 && r <= 0x05EA }

// HasHebrew reports whether s contains a Hebrew letter.
func HasHebrew(s string) bool {
	for _, r := range s {
		if isHebrew(r) {
			return true
		}
	}
	return false
}

func hasLetter(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// tokens folds s and splits it; when the text contains Hebrew, purely non-Hebrew words
// (the English half of a bilingual name) are dropped.
func tokens(s string) []string {
	f := strings.Fields(fold(s))
	if !HasHebrew(s) {
		return f
	}
	out := f[:0:0]
	for _, t := range f {
		if hasLetter(t) && !HasHebrew(t) {
			continue
		}
		out = append(out, t)
	}
	return out
}

var streetPrefix = map[string]bool{
	"רחוב": true, "רח": true, "שדרות": true, "שד": true, "שדרת": true, "דרך": true,
	"סמטת": true, "סמטה": true, "כיכר": true, "ככר": true,
}

// spelling variants applied to every token.
var tokenFix = map[string]string{
	"ק":     "קרית",
	"ר":     "רבי",
	"קריית": "קרית",
	"קרית":  "קרית",
	"קריה":  "קרית",
	"קרייה": "קרית",
}

func fixTokens(t []string) []string {
	for i, w := range t {
		if r, ok := tokenFix[w]; ok {
			t[i] = r
		}
	}
	return t
}

// NormStreet is the canonical key of a street name: no quotes, no street-type prefix
// (רחוב, שד', דרך, סמטת...), single spaces.
func NormStreet(s string) string {
	t := fixTokens(tokens(s))
	for len(t) > 1 && streetPrefix[t[0]] {
		t = t[1:]
	}
	return strings.Join(t, " ")
}

// city abbreviations as they appear in store files, after quotes are stripped.
var cityAbbr = map[string]string{
	"תא":     "תל אביב",
	"רג":     "רמת גן",
	"בב":     "בני ברק",
	"פת":     "פתח תקוה",
	"בש":     "באר שבע",
	"ראשלצ":  "ראשון לציון",
	"הרצליה": "הרצליה",
	"רעננה":  "רעננה",
	"קג":     "קרית גת",
	"קש":     "קרית שמונה",
	"קמ":     "קרית מוצקין",
	"קב":     "קרית ביאליק",
	"קא":     "קרית אונו",
	"קי":     "קרית ים",
	"רהע":    "רמת השרון",
	"נתניה":  "נתניה",
}

// NormCity is the canonical key of a city name: "תל אביב - יפו" -> "תל אביב יפו",
// "קריית אונו" and "ק. אונו" -> "קרית אונו".
func NormCity(s string) string {
	t := fixTokens(tokens(s))
	var out []string
	for _, w := range t {
		if full, ok := cityAbbr[w]; ok {
			out = append(out, strings.Fields(full)...)
			continue
		}
		out = append(out, w)
	}
	for len(out) > 1 && (out[0] == "עיריית" || out[0] == "עיריה") {
		out = out[1:]
	}
	return strings.Join(out, " ")
}

var titleWords = map[string]bool{
	"דר": true, "פרופ": true, "הרב": true, "רבי": true, "הרבי": true, "האלוף": true, "אלוף": true,
	"הנשיא": true, "נשיא": true, "המלך": true, "מלך": true, "גנרל": true, "הגנרל": true, "מר": true,
	"הגאון": true, "האדמור": true, "הרבנית": true, "אדמור": true, "הרמב": true,
}

// Skeleton is a loose key that survives Hebrew spelling variants: no vav/yod, no spaces,
// no honorifics (הרב, ד"ר, האלוף...). "יהושוע חנקין" and "יהושע חנקין" collide.
func Skeleton(norm string) string {
	var kept []string
	for _, w := range strings.Fields(norm) {
		if !titleWords[w] {
			kept = append(kept, w)
		}
	}
	if len(kept) == 0 {
		kept = strings.Fields(norm)
	}
	var b strings.Builder
	for _, w := range kept {
		for _, r := range w {
			if r == 'ו' || r == 'י' {
				continue
			}
			b.WriteRune(r)
		}
	}
	return b.String()
}

// generic words that precede the real name of a shopping centre.
var poiGeneric = map[string]bool{
	"קניון": true, "מרכז": true, "מסחרי": true, "קניות": true, "מתחם": true, "קניוני": true, "מסחר": true,
}

// NormPOI is the key of a mall / commercial-centre name, without the generic words
// ("מרכז קניות נטו" -> "נטו"; "קניון עזריאלי" -> "עזריאלי").
func NormPOI(s string) string {
	t := fixTokens(tokens(s))
	var out []string
	for _, w := range t {
		if !poiGeneric[w] {
			out = append(out, w)
		}
	}
	if len(out) == 0 {
		out = t
	}
	return strings.Join(out, " ")
}

// editDistLE1 reports whether a and b differ by at most one insertion, deletion or substitution.
func editDistLE1(a, b string) bool {
	ra, rb := []rune(a), []rune(b)
	if len(ra) < len(rb) {
		ra, rb = rb, ra
	}
	if len(ra)-len(rb) > 1 {
		return false
	}
	i := 0
	for i < len(rb) && ra[i] == rb[i] {
		i++
	}
	if i == len(rb) {
		return true
	}
	if len(ra) == len(rb) {
		return string(ra[i+1:]) == string(rb[i+1:])
	}
	return string(ra[i+1:]) == string(rb[i:])
}
