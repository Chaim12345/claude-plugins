package shop

// Product is one catalog product (the TypeScript Product of mobile/src/lib/types.ts), typed.
type Product struct {
	Code     string
	Name     string
	Cat      string
	Weighted bool     // price per kg
	Prices   []int32  // agorot per store index, -1 = not sold there
	Picks    []string // fresh items: the matched name per store
	Img      string   // barcode to look a photo up by
	Maker    string
	IL       bool        // made in Israel
	Stale    map[int]int // store index -> days since that branch last sold it (14+)
	Chg      map[int]int // store index -> days since the price changed (within 30)
	NP       []int       // stores that list it without a price
	Odd      [][2]int    // [store, agorot]: a price 4x off the others, set aside
	RawName  string      // the name in the price files, when AI curation tidied Name
	Key      string      // normalised search text

	StatedSize  StatedSize // pack size the chains state in their files (ProductMeta.Size)
	StatedAgree int        // how many chains agree on it
	AI          *Record    // the model's record, when there is one

	size             Size // SizeOf, remembered
	sizeOK, sizeDone bool
}

// IsStale: the branch hasn't sold it for StaleDays or more (it may not be on the shelf).
func (p *Product) IsStale(i int) bool { return p.Stale[i] >= StaleDays }

// StatedSize is ProductMeta.Size: an amount and its kind.
type StatedSize struct {
	Kind   UnitKind
	Amount float64
}

// Record is the model's record of a product (the AI classification), as stored.
type Record struct {
	T  string   `json:"t"`            // product type: "חלב", "גבינה לבנה"
	C  string   `json:"c"`            // category id
	B  string   `json:"b"`            // brand
	L  string   `json:"l"`            // product line
	V  string   `json:"v"`            // variant
	S  *SizeRec `json:"s,omitempty"`  // pack size
	D  []string `json:"d,omitempty"`  // diet and kashrut tags
	PL bool     `json:"pl,omitempty"` // a chain's own brand
	Q  bool     `json:"q,omitempty"`  // the model was unsure
}

// SizeRec is the record's pack size: Amount per pack in Unit ("g", "ml", "u"), Packs packs.
type SizeRec struct {
	Amount float64 `json:"a"`
	Unit   string  `json:"u"`
	Packs  int     `json:"p"`
}

func (r *SizeRec) size() Size {
	k := Count
	switch r.Unit {
	case "g":
		k = Weight
	case "ml":
		k = Volume
	}
	packs := max(r.Packs, 1)
	return Size{k, r.Amount * float64(packs), packs}
}

// Diet tags the model may give, and their Hebrew labels.
var Diets = []string{"kosher", "mehadrin", "badatz", "parve", "dairy", "meat", "gluten_free", "sugar_free", "low_fat", "organic", "vegan", "lactose_free", "high_protein", "diet"}

var DietLabel = map[string]string{
	"kosher": "כשר", "mehadrin": "מהדרין", "badatz": "בד״ץ", "parve": "פרווה", "dairy": "חלבי", "meat": "בשרי", "gluten_free": "ללא גלוטן",
	"sugar_free": "ללא סוכר", "low_fat": "דל שומן", "organic": "אורגני", "vegan": "טבעוני", "lactose_free": "ללא לקטוז", "high_protein": "עתיר חלבון", "diet": "דיאט",
}
