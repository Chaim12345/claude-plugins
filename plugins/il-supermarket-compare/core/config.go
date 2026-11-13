package core

func f(v float64) *float64 { return &v }

// DefaultConfig is the Ramat Gan / Bnei Brak / Givatayim area used by the prototype.
// Coordinates come from OpenStreetMap Nominatim; Approx marks a city-centre fallback.
func DefaultConfig() Config {
	return Config{MinStores: 3, Stores: append([]StoreRef(nil), defaultStores...), Areas: append([]Area(nil), defaultAreas...)}
}

var defaultStores = []StoreRef{
	{Chain: "RamiLevi", StoreID: "16", ChainName: "רמי לוי", Branch: "בני ברק איילון", Address: "מבצע קדש 68, בני ברק", Lat: f(32.1015211), Lon: f(34.830848), Approx: false},
	{Chain: "RamiLevi", StoreID: "731", ChainName: "רמי לוי", Branch: "ביאליק רמת גן", Address: "ביאליק 79, רמת גן", Lat: f(32.0856761), Lon: f(34.8103438), Approx: false},
	{Chain: "osherad", StoreID: "11", ChainName: "אושר עד", Branch: "בני ברק", Address: "הקישון 11, בני ברק", Lat: f(32.0989366), Lon: f(34.8300524), Approx: false},
	{Chain: "shufersal", StoreID: "611", ChainName: "יש חסד", Branch: "בני ברק השומר", Address: "השומר 10, בני ברק", Lat: f(32.0873899), Lon: f(34.8324376), Approx: true},
	{Chain: "shufersal", StoreID: "241", ChainName: "שופרסל יוניברס", Branch: "בני ברק איילון", Address: "הלח\"י 28, בני ברק", Lat: f(32.1029255), Lon: f(34.8359513), Approx: false},
	{Chain: "shufersal", StoreID: "70", ChainName: "שופרסל שלי", Branch: "רמת גן מרום נווה", Address: "תרצה 19, רמת גן", Lat: f(32.0716378), Lon: f(34.8291904), Approx: false},
	{Chain: "Keshet", StoreID: "104", ChainName: "קשת טעמים", Branch: "קולינריק רמת גן", Address: "ביאליק 39, רמת גן", Lat: f(32.0834292), Lon: f(34.8142548), Approx: false},
	{Chain: "TivTaam", StoreID: "88", ChainName: "טיב טעם", Branch: "רמת אפעל", Address: "דרך שיבא 16, רמת גן", Lat: f(32.0473597), Lon: f(34.8348769), Approx: false},
}

var defaultAreas = []Area{
	{Name: "רמת גן, מרכז", Lat: 32.0841983, Lon: 34.8140537},
	{Name: "בני ברק", Lat: 32.0857673, Lon: 34.8324308},
	{Name: "גבעתיים", Lat: 32.0750577, Lon: 34.8075414},
	{Name: "רמת אפעל", Lat: 32.0473597, Lon: 34.8348769},
}
