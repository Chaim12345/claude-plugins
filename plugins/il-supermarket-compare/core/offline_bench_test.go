package core

import (
	"bytes"
	"testing"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/osmindex"
)

func BenchmarkOfflineLoad(b *testing.B) {
	for i := 0; i < b.N; i++ {
		if _, err := osmindex.Load(bytes.NewReader(embeddedGeoIndex)); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkOfflineLookup(b *testing.B) {
	OfflineIndex()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		offlinePlace("ביאליק 50", "רמת גן")
	}
}
