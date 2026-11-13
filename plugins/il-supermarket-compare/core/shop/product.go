package shop

// Product is one catalog product in Go (the TypeScript Product of mobile/src/lib/types.ts). Only the
// fields the unit-price logic needs so far; the rest arrive with the Go-rendered UI.
type Product struct {
	Code     string
	Name     string
	Cat      string
	Weighted bool
	RawName  string // the name in the price files, when AI curation tidied Name

	StatedSize  StatedSize // pack size the chains state in their files (ProductMeta.Size)
	StatedAgree int        // how many chains agree on it
	AI          *Record    // the model's record (enrichment), when there is one

	size             Size // SizeOf, remembered
	sizeOK, sizeDone bool
}

// StatedSize is ProductMeta.Size: an amount and its kind.
type StatedSize struct {
	Kind   UnitKind
	Amount float64
}

// Record is the part of the model's product record (mobile/src/lib/enrich.ts) the Go side uses.
type Record struct {
	S *SizeRec // [amount per pack, unit, packs]
}

// SizeRec is the record's pack size: Amount per pack in Unit ("g", "ml", "u"), Packs packs.
type SizeRec struct {
	Amount float64
	Unit   string
	Packs  int
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
