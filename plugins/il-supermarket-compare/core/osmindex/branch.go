package osmindex

import "strings"

// LookupBranch matches a supermarket branch to an OSM shop POI of the same brand in the same
// city (banner e.g. "שופרסל דיל", branch name e.g. "שופרסל דיל רמת אביב"). With several shops
// of the brand in the city it needs the branch name or address to single one out; otherwise it
// reports no match rather than guessing.
func (ix *Index) LookupBranch(banner, name, city, address string) (Result, bool) {
	cids := ix.cityIDs(city)
	bt := brandTokens(banner)
	if len(bt) == 0 {
		bt = brandTokens(name)
	}
	if len(bt) == 0 {
		return Result{}, false
	}
	for _, cid := range cids {
		var cand []int32
		for _, i := range ix.cityBrands[cid] {
			br := ix.Brands[i]
			if tokenSubsetAny(bt, strings.Fields(br.Brand)) || tokenSubsetAny(strings.Fields(br.Brand), bt) && len(br.Brand) >= 6 {
				cand = append(cand, i)
			}
		}
		if len(cand) == 1 {
			p := ix.Brands[cand[0]]
			return Result{Lat: deg(p.Lat), Lon: deg(p.Lon), Precision: PrecBranch, Method: "brand-unique", Street: p.Name}, true
		}
		if len(cand) > 1 {
			// disambiguate by words of the branch name / address that the shop's own name carries
			words := map[string]bool{}
			for _, t := range tokens(name + " " + address) {
				words[t] = true
			}
			best, bs, tie := int32(-1), 0, false
			for _, i := range cand {
				sc := 0
				for _, t := range strings.Fields(ix.Brands[i].Name) {
					if words[t] && !contains(bt, t) {
						sc++
					}
				}
				if sc > bs {
					best, bs, tie = i, sc, false
				} else if sc == bs && sc > 0 {
					tie = true
				}
			}
			if best >= 0 && !tie {
				p := ix.Brands[best]
				return Result{Lat: deg(p.Lat), Lon: deg(p.Lon), Precision: PrecBranch, Method: "brand-name", Street: p.Name}, true
			}
		}
	}
	return Result{}, false
}

func brandTokens(s string) []string {
	var out []string
	for _, t := range fixTokens(tokens(s)) {
		if len([]rune(t)) >= 2 {
			out = append(out, t)
		}
	}
	return out
}

func contains(a []string, s string) bool {
	for _, x := range a {
		if x == s {
			return true
		}
	}
	return false
}
