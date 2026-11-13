package app

import (
	"testing"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

func TestCatalogTools(t *testing.T) {
	c := fixture()
	c.Products = append(c.Products,
		[]any{"333", "גבינה לבנה 5% תנובה 250 גרם", "dairy", 0, []any{500, nil}, nil, nil, nil},
		[]any{"444", "גבינה לבנה 5% תנובה 250 גרם ", "dairy", 0, []any{nil, 520}, nil, nil, nil},
		[]any{"555", "שוקולד חלב עלית100גרם", "snacks", 0, []any{900, 880}, nil, nil, nil},
	)
	e := open(t, c)

	v := e.Catalog()
	if v.LinkTodo != 1 || v.NameTodo != 1 {
		t.Fatalf("todo: links %d names %d", v.LinkTodo, v.NameTodo)
	}

	// a cleaned name shows right away, and can be undone
	e.curApply(func(c *shop.Curation) { c.Names["555"] = "שוקולד חלב עלית 100 גרם" })
	if p := e.Product("555"); p.Name != "שוקולד חלב עלית 100 גרם" {
		t.Errorf("clean name: %q", p.Name)
	}
	e.ReviewName("555", "undo")
	if p := e.Product("555"); p.Name != "שוקולד חלב עלית100גרם" {
		t.Errorf("undone name: %q", p.Name)
	}

	// a link waits for approval, then merges; the cart follows the merge
	e.SetQty("444", 2)
	e.curApply(func(c *shop.Curation) { c.Links["444"] = "333" })
	if v := e.Catalog(); v.Waiting != 1 || v.Links != 0 {
		t.Errorf("waiting link: %+v", v)
	}
	if e.Product("444").Found == false {
		t.Error("unapproved link must not hide the product")
	}
	e.ReviewLink("444", "approve")
	if e.Product("444").Found {
		t.Error("merged-away barcode still found")
	}
	p := e.Product("333")
	if len(p.Rows) != 2 {
		t.Errorf("merged product has %d prices, want 2", len(p.Rows))
	}
	if q := e.st.Cart["333"]; q != 2 || e.st.Cart["444"] != 0 {
		t.Errorf("cart after merge: %v", e.st.Cart)
	}
	// undoing brings the second barcode back
	e.ReviewLink("444", "reject")
	if !e.Product("444").Found {
		t.Error("rejected link did not restore the product")
	}
}
