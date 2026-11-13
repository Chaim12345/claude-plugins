package spike

import "testing"

func TestLoadAndSearch(t *testing.T) {
	ms := Load()
	if n := Search(""); n != 37153 {
		t.Fatalf("all = %d", n)
	}
	n := Search("גבינה צהובה")
	t.Logf("load %d ms, 'גבינה צהובה' -> %d in %d µs; first: %s %s", ms, n, SearchMicros(), Name(0), Price(0))
	if n == 0 || Name(0) == "" {
		t.Fatal("no cheese")
	}
}
