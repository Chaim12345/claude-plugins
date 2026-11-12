package core

import (
	"math"
	"regexp"
	"sort"
	"strings"
)

// Catalog is what the apps render. Its JSON shape is the same data.json the web prototype reads.
type Catalog struct {
	PriceDate   string     `json:"priceDate"`
	GeneratedAt string     `json:"generatedAt"`
	Stores      []Store    `json:"stores"`
	Skipped     []string   `json:"skipped"`
	Areas       []Area     `json:"areas"`
	Categories  []Category `json:"categories"`
	// Each product: [code, name, category, weighted (1 = price per kg), prices in agorot per store (null = not sold),
	// matched names per store (fresh items only, else null), image code (barcode to look a photo up by, or null)]
	Products [][]any  `json:"products"`
	Images   []string `json:"imageSources"` // URL templates tried in order; {code} is replaced
	// Promos[i] are store i's promotions (see Promo), referring to packaged product codes. Older
	// catalogs and consumers that ignore the field keep working with shelf prices.
	Promos     [][]Promo    `json:"promos"`
	PromoStats []PromoStats `json:"promoStats,omitempty"`
}

type Store struct {
	ID        string   `json:"id"` // chain:store_id
	Chain     string   `json:"chain"`
	Branch    string   `json:"branch"`
	Address   string   `json:"address"`
	Lat       *float64 `json:"lat"`
	Lon       *float64 `json:"lon"`
	Approx    bool     `json:"approx"`
	File      string   `json:"file,omitempty"`      // the published file these prices came from
	FileTime  string   `json:"fileTime,omitempty"`  // its timestamp, YYYYMMDDhhmm
	PromoFile string   `json:"promoFile,omitempty"` // the PromoFull file the promos came from, if any
}

type Area struct {
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// wb is a word boundary that understands Hebrew (RE2's \b is ASCII-only).
const wb = `(?:$|[^\p{L}\p{N}])`

func rx(s string) *regexp.Regexp {
	if s == "" {
		return nil
	}
	return regexp.MustCompile("(?i)" + strings.ReplaceAll(s, `\b`, wb))
}

type rule struct {
	key      string
	inc, exc *regexp.Regexp
}

func (r rule) match(name string) bool {
	return r.inc.MatchString(name) && (r.exc == nil || !r.exc.MatchString(name))
}

// FreshRule matches a canonical fresh item (chain-specific codes) by name, priced per kg.
type FreshRule struct {
	ID, Label, Category string
	inc, exc            *regexp.Regexp
	Min, Max            float64 // sane ₪/kg range; outside it is a data error or a different product
}

func fresh(id, label, cat, inc, exc string, lo, hi float64) FreshRule {
	return FreshRule{ID: id, Label: label, Category: cat, inc: rx(inc), exc: rx(exc), Min: lo, Max: hi}
}

var FreshRules = []FreshRule{
	fresh("f-tomato", "עגבניות", "produce", `^עגבני(ה|ות)\b`, `שרי|מגי|אורגנ|תמר|מיובש|גבינ`, 3, 25),
	fresh("f-cucumber", "מלפפונים", "produce", `^מלפפו(ן|נים)\b`, `אורגנ|בייבי|מלח|חומץ`, 2, 20),
	fresh("f-potato", "תפוחי אדמה לבנים", "produce", `^(תפו"?א|תפוחי? אדמה)`, `אדום|ירושלמי|כסביה|אורגנ|בורקס|סלט|אפוי|פלחי|כיסונ|לאפיה|קטן|גורמה|פרימיום|פרמיום`, 2, 15),
	fresh("f-sweetpotato", "בטטה", "produce", `^בטטה`, `סלט|פלחי`, 3, 20),
	fresh("f-onion", "בצל יבש", "produce", `^בצל( יבש)?\b`, `אדום|אורגנ|ירוק|מטוגן`, 2, 15),
	fresh("f-carrot", "גזר", "produce", `^גזר`, `אורגנ|מארז|גמדי|מגורד`, 2, 12),
	fresh("f-redpepper", "פלפל אדום", "produce", `^פלפל אדום`, `אורגנ|קלוי|ממולא`, 4, 30),
	fresh("f-zucchini", "קישואים", "produce", `^קישוא`, `אורגנ|עגול|צהוב`, 3, 25),
	fresh("f-eggplant", "חצילים", "produce", `^חציל`, `בלאדי|בלדי|סלט`, 3, 20),
	fresh("f-cabbage", "כרוב לבן", "produce", `^כרוב לבן`, `כשר|אורגנ|ממולא|מהדרין|רמי לוי|חסלט|יבולי|קטיף`, 2, 12),
	fresh("f-lemon", "לימון", "produce", `^לימון\b`, `ליים|אורגנ`, 3, 20),
	fresh("f-banana", "בננה", "produce", `^בננ`, `אורגנ|שריר`, 4, 20),
	fresh("f-avocado", "אבוקדו", "produce", `^אבוקדו`, `רשת|קרטונ|מארז|סלט`, 5, 30),
	fresh("f-orange", "תפוזים", "produce", `^תפוז(ים)?( ברשת)?$`, ``, 3, 15),
	fresh("f-clementine", "קלמנטינות", "produce", `^קלמנטינ`, ``, 3, 15),
	fresh("f-apple", "תפוח עץ (הזן הזול בסניף)", "produce", `^תפוח עץ`, `אורגנ|סטורי|ברשת`, 5, 25),
	fresh("f-grapes", "ענבים ירוקים", "produce", `^ענב(ים)? (ירוק|לבן)`, `אורגנ`, 10, 45),
	fresh("f-chickenbreast", "חזה עוף טרי", "meat", `^(חזה|פילה) עוף`, `קפוא|שלם|חצוי|פרוס|"יש"|מעושן|מתובל`, 25, 70),
	fresh("f-schnitzel", "שניצל עוף טרי", "meat", `^שניצל(ון)? עוף`, `קפוא|שניצלוני|מתובל|פרימיום|בוטיק`, 30, 70),
	fresh("f-thighs", "כרעיים עוף טריות", "meat", `^כרעיים( עוף)?`, `קפוא|מתובל|מעושנ|בשום|איטלקי|בלי עור|מקוצב|"יש"`, 15, 50),
	fresh("f-drumsticks", "שוקיים עוף טריות", "meat", `^שוקיים( עוף)?`, `קפוא|הודו|בלי עור|"יש"`, 15, 55),
	fresh("f-groundbeef", "בשר בקר טחון טרי", "meat", `(בקר טחון|בשר( בקר)? טחון|טחון בקר|בשר טחון)`, `קפוא|עגל|הודו|עוף|צלעות`, 45, 110),
}

var CategoryNames = []Category{
	{"produce", "פירות וירקות"}, {"meat", "בשר, עוף ודגים"}, {"dairy", "חלב, גבינות וביצים"}, {"bakery", "לחם ומאפים"},
	{"drinks", "משקאות"}, {"snacks", "חטיפים ומתוקים"}, {"pantry", "מזווה"}, {"frozen", "קפואים"},
	{"cleaning", "ניקיון ובית"}, {"care", "טיפוח ותינוקות"}, {"pets", "חיות מחמד"}, {"other", "שונות"},
}

// categoryRules: ordered, first match wins. A key can repeat: an early narrow rule claims items
// that a later broad rule would grab ("שוקולד חלב" is a snack, not dairy).
var categoryRules = []rule{
	{"produce", rx(`^(עגבני|מלפפון|פלפל |חסה|כרוב|גזר|בצל|שום |תפוח עץ|בננ|אבוקדו|לימון|תפוז|קלמנטינ|ענב|אגס|פטריות|נבטים|עשבי|פטרוזיליה|כוסברה|שמיר|נענע|סלק|קישוא|חציל|בטטה|תות|אוכמניות|מארז אוכמניות|מלון|אבטיח|עגבניות שרי)`), nil},
	{"pets", rx(`כלב|חתול|גורים|דוגלי|ויסקס|פריסקיז|פדיגרי|בונזו|חול ל`), nil},
	{"frozen", rx(`קפוא|מוקפא|גלידה|ארטיק|שלגון|בצק עלים|קרפלך|רביולי|כיסונ`), nil},
	{"pantry", rx(`^מרק|אבקת מרק|ציר |^רוטב|^תערובת|^סירופ|תמצית|אצות|קוקטייל פירות|אננס|אפרס`), nil},
	{"snacks", rx(`שוקולד|חטיף|במבה|ביסלי|ופל`), nil},
	{"dairy", rx(`יוגורט|^גבינ`), nil},
	{"cleaning", rx(`רצפות|קוטל|לילי |גלילים|מרכך `), rx(`מרכך ל?שיער|מרכך נגד`)},
	{"care", rx(`תח\.ספיגה|תחתוני ספיגה|חיתול|האגיס|פמפרס|טיטולים|קרפרי|תחבושת|טמפון|מטרנה|סימילאק|תמ"ל|שמפו|מרכך שיער|דאודורנט|משחת שיניים|מברשת שיניים|ג'ל רחצה|תחליב|גילוח|סכיני|קולגייט|אוראל|ניוואה|דאב |הד אנד|פינוק|מרכך ל?שיער|מרכך נגד|דאו |שפתון|שעווה|אולוויז|משחת|מרידול|אל תוש|קרם (ידיים|גוף|פנים|הגנה)|סבון (ידיים|גוף|נוזלי)|משייף|מסיר איפור|מי פה|צמר גפן|קיסמי`), nil},
	{"cleaning", rx(`אקונומיקה|כביסה|מרכך כביסה|מדיח|ספוג|מגבונ|נייר טואלט|מגבות? נייר|סופר מגבת|שקיות|נייר אפיה|נייר כסף|רדיד|מטהר|מסיר|ניקוי|נוזל כלים|פרסיל|אריאל|סנו|פיניש|טישו|ממחטות|סבון כלים|אשפ|כוסות|צלחות|מזלגות|כפיות|מפיות|מטלית|גפרורים|ניקול|פיירי|XPO|נ\.רצפה|רצפות|סוללות|נרות|קיסמים|תבניות? אלומיניום|כלים חד`), nil},
	{"meat", rx(`עוף|בקר|הודו|כבש|שניצל|נקניק|קבב|המבורגר|פסטרמה|סלמי|טונה|סרדינ|סלמון|דג |דגי|אמנון|לוקוס|נסיכת|הרינג|שרימפס|בשר|קציצות|מעדנות`), rx(`כבשים`)},
	{"dairy", rx(`חלב|גבינ|^גב\.|^ג\.|יוגורט|יופלה|מעדן|^לבן |לבנה|קוטג|שמנת|חמאה|ביצים|ביצה|דנונ|אקטימל|מילקי|פודינג|צפתית|בולגרית|מוצרלה|פטה|ריקוטה|קפיר|פרמזן|פרמזנו|פקורינו|גאודה|עמק|נעם|גלבוע|קממבר|ברי |צ'דר|אמנטל|מסקרפונה|יטבתה|תנובה|שטראוס|דני |גו |כבשים`), nil},
	{"bakery", rx(`לחם|לחמני|פיתה|פיתות|בגט|חלה|חלות|טורטיה|מאפה|עוגה|עוגת|עוגיות|רוגלך|קרואסון|בורקס|מצה|קרקר|פריכיות|לחמית|בייגל|כעכים|ביסקוויט|וופל|טוסט`), nil},
	{"drinks", rx(`מים |^מים|סודה|קולה|ספרייט|פאנטה|סבן אפ|מיץ|נקטר|משקה|^תה |חליטת|ליפטון|ויסוצקי|קפה|נס קפה|נספרסו|יין|בירה|וודקה|וויסקי|ליקר|ערק|פריגת|ספרינג|שוופס|אנרגיה|רד בול|נביעות|עין גדי|קפסול|שרדונה|קברנה|מרלו|סוביניון|רוזה|מוסקטו|למברוסקו|גולדסטאר|קרלסברג|הייניקן|סמוזי|פיוז טי|נסטי`), nil},
	{"snacks", rx(`במבה|ביסלי|תפוצ|דוריטוס|ציפס|צ'יפס|חטיף|שוקולד|ש\.מריר|ש\.חלב|סוכרי|מסטיק|קליק|פסק זמן|מקופלת|קינדר|בונבונ|קרמבו|ממתק|גומי|לוטוס|אגוזי|פיצוח|גרעינ|שקדים|בוטנים|פופקורן|דגני|קורנפלקס|גרנולה|פיטנס|כריות|חלבה|ממרח|מנטוס|טוסו|מרציפן|בייגלה|גמייקה|סלים|ליציס|קינוח|מקדמיה|קשיו|פיסטוק|צימוק|פירות יבשים|תמרים|אגוז|טופי|מרשמלו|סוכריות|ריבת חלב|נוטלה|אפרופו|תפוציפס|צ'יטוס|פרינגלס`), nil},
	{"pantry", rx(`אורז|פסטה|ספגטי|פנה|פתיתים|קמח|סוכר|מלח|שמן|חומץ|קטשופ|מיונז|חרדל|טחינה|חומוס|שעועית|עדשים|תירס|זיתים|מלפפונים|רסק|שימורי|תבלין|פפריקה|כמון|פלפל שחור|אבקת|שמרים|דבש|ריבה|קוסקוס|בורגול|קינואה|פירורי|אטריות|נודלס|רכז|קוקוס|וניל|סילאן|קנולה|גלטין|אפונ|שקשוקה|לקט|סלט|מטבל|אנשובי|קפרי|רוטב|פסטו|ג'לי|קורנפלור|סודה לשתיה|אבקת אפיה|לימון כבוש`), nil},
}

func Categorize(name string) string {
	for _, r := range categoryRules {
		if r.match(name) {
			return r.key
		}
	}
	return "other"
}

// StoreData is one store's parsed price file.
type StoreData struct {
	Store  Store
	Items  []Item
	Promos *PromoFile // nil = no promotions file for this store
}

// RamiLevyChain is the chain key whose CDN serves product photos by item code.
const RamiLevyChain = "RamiLevi"

// BuildCatalog matches products across stores.
//   - Packaged goods: same barcode in at least minStores stores. A price more than 4x off the product's
//     median is dropped as a unit or data-entry error.
//   - Fresh items: FreshRules, cheapest in-range match per store.
func BuildCatalog(stores []StoreData, minStores int, chainKeys []string) [][]any {
	n := len(stores)
	type entry struct {
		names  []string
		prices []float64 // NaN = missing
	}
	byCode := map[string]*entry{}
	for i, sd := range stores {
		for _, it := range sd.Items {
			if len(it.Code) < 7 || it.Weighted {
				continue
			}
			e := byCode[it.Code]
			if e == nil {
				e = &entry{prices: make([]float64, n)}
				for k := range e.prices {
					e.prices[k] = math.NaN()
				}
				byCode[it.Code] = e
			}
			if math.IsNaN(e.prices[i]) {
				e.prices[i] = it.Price
				e.names = append(e.names, it.Name)
			}
		}
	}

	var products [][]any
	for code, e := range byCode {
		var have []float64
		for _, p := range e.prices {
			if !math.IsNaN(p) {
				have = append(have, p)
			}
		}
		if len(have) < minStores {
			continue
		}
		med := median(have)
		prices := make([]any, n)
		kept := 0
		for i, p := range e.prices {
			if !math.IsNaN(p) && p >= med/4 && p <= med*4 {
				prices[i] = int(math.Round(p * 100))
				kept++
			}
		}
		if kept < minStores {
			continue
		}
		name := e.names[0]
		for _, s := range e.names {
			if len([]rune(s)) > len([]rune(name)) {
				name = s
			}
		}
		products = append(products, []any{code, name, Categorize(name), 0, prices, nil, code})
	}

	for _, fr := range FreshRules {
		prices, picks := make([]any, n), make([]any, n)
		var img any
		found := 0
		for i, sd := range stores {
			var best *Item
			for k := range sd.Items {
				it := &sd.Items[k]
				if !it.Weighted || it.Price < fr.Min || it.Price > fr.Max || !fr.inc.MatchString(it.Name) || (fr.exc != nil && fr.exc.MatchString(it.Name)) {
					continue
				}
				if best == nil || it.Price < best.Price {
					best = it
				}
			}
			if best != nil {
				prices[i], picks[i] = int(math.Round(best.Price*100)), best.Name
				found++
				if img == nil && i < len(chainKeys) && chainKeys[i] == RamiLevyChain && len(best.Code) >= 7 {
					img = best.Code
				}
			}
		}
		if found >= 2 {
			products = append(products, []any{fr.ID, fr.Label, fr.Category, 1, prices, picks, img})
		}
	}

	count := func(p []any) int {
		c := 0
		for _, v := range p[4].([]any) {
			if v != nil {
				c++
			}
		}
		return c
	}
	sort.SliceStable(products, func(a, b int) bool {
		wa, wb := products[a][3].(int), products[b][3].(int)
		if wa != wb {
			return wa > wb
		}
		ca, cb := count(products[a]), count(products[b])
		if ca != cb {
			return ca > cb
		}
		return products[a][1].(string) < products[b][1].(string)
	})
	return products
}

func median(xs []float64) float64 {
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

func UsedCategories(products [][]any) []Category {
	used := map[string]bool{}
	for _, p := range products {
		used[p[2].(string)] = true
	}
	var out []Category
	for _, c := range CategoryNames {
		if used[c.ID] {
			out = append(out, c)
		}
	}
	return out
}
