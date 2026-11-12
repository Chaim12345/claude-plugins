"""Build data.json for the Supermarket Basket web app from today's official price files.

Reuses the plugin's fetchers (../skills/il-supermarket-compare/scripts/chains.py), so the
app and the Claude skill read exactly the same sources.

usage: python ingest.py [--out data.json] [--min-stores 3]
Edit STORES below to change the area. Run it daily (e.g. from a scheduled task) and republish.

What it produces:
  - stores: the branches, with coordinates (OpenStreetMap Nominatim, cached).
  - products: packaged goods matched across chains by barcode (present in >= --min-stores stores),
    plus canonical fresh items (produce, chicken, beef) matched by name rules, priced per kg.
  - Prices are in agorot; null = not sold at that store today.
"""
import argparse, datetime, json, os, re, statistics, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "skills" / "il-supermarket-compare" / "scripts"))

from chains import CACHE, TODAY  # noqa: E402
from prices import download  # noqa: E402
from find_stores import geocode  # noqa: E402

# chain key, store id, chain label, branch label, address, city, geocode query (None = use the address)
STORES = [
    ("RamiLevi", "16", "רמי לוי", "בני ברק איילון", "מבצע קדש 68", "בני ברק", None),
    ("RamiLevi", "731", "רמי לוי", "ביאליק רמת גן", "ביאליק 79", "רמת גן", None),
    ("osherad", "11", "אושר עד", "בני ברק", "הקישון 11", "בני ברק", None),
    ("shufersal", "611", "יש חסד", "בני ברק השומר", "השומר 10", "בני ברק", None),
    ("shufersal", "241", "שופרסל יוניברס", "בני ברק איילון", "הלח\"י 28", "בני ברק", "לח\"י 28, בני ברק"),
    ("shufersal", "70", "שופרסל שלי", "רמת גן מרום נווה", "תרצה 19", "רמת גן", None),
    ("Keshet", "104", "קשת טעמים", "קולינריק רמת גן", "ביאליק 39", "רמת גן", None),
    ("TivTaam", "88", "טיב טעם", "רמת אפעל", "דרך שיבא 16", "רמת גן", "רמת אפעל"),
]

# Starting points the viewer can measure distance from.
AREAS = [
    ("רמת גן, מרכז", "ביאליק 50, רמת גן"),
    ("בני ברק", "רבי עקיבא 100, בני ברק"),
    ("גבעתיים", "כצנלסון 50, גבעתיים"),
    ("רמת אפעל", "רמת אפעל"),
]

# Fresh items have chain-specific codes, so they're matched by name.
# (id, display name, category, include regex, exclude regex, min ₪/kg, max ₪/kg)
FRESH = [
    ("f-tomato", "עגבניות", "produce", r"^עגבני(ה|ות)\b", r"שרי|מגי|אורגנ|תמר|מיובש|גבינ", 3, 25),
    ("f-cucumber", "מלפפונים", "produce", r"^מלפפו(ן|נים)\b",r"אורגנ|בייבי|מלח|חומץ", 2, 20),
    ("f-potato", "תפוחי אדמה לבנים", "produce", r"^(תפו\"?א|תפוחי? אדמה)", r"אדום|ירושלמי|כסביה|אורגנ|בורקס|סלט|אפוי|פלחי|כיסונ|לאפיה|קטן|גורמה|פרימיום|פרמיום", 2, 15),
    ("f-sweetpotato", "בטטה", "produce", r"^בטטה", r"סלט|פלחי", 3, 20),
    ("f-onion", "בצל יבש", "produce", r"^בצל( יבש)?\b", r"אדום|אורגנ|ירוק|מטוגן", 2, 15),
    ("f-carrot", "גזר", "produce", r"^גזר", r"אורגנ|מארז|גמדי|מגורד", 2, 12),
    ("f-redpepper", "פלפל אדום", "produce", r"^פלפל אדום", r"אורגנ|קלוי|ממולא", 4, 30),
    ("f-zucchini", "קישואים", "produce", r"^קישוא", r"אורגנ|עגול|צהוב", 3, 25),
    ("f-eggplant", "חצילים", "produce", r"^חציל", r"בלאדי|בלדי|סלט", 3, 20),
    ("f-cabbage", "כרוב לבן", "produce", r"^כרוב לבן", r"כשר|אורגנ|ממולא|מהדרין|רמי לוי|חסלט|יבולי|קטיף", 2, 12),
    ("f-lemon", "לימון", "produce", r"^לימון\b", r"ליים|אורגנ", 3, 20),
    ("f-banana", "בננה", "produce", r"^בננ", r"אורגנ|שריר", 4, 20),
    ("f-avocado", "אבוקדו", "produce", r"^אבוקדו", r"רשת|קרטונ|מארז|סלט", 5, 30),
    ("f-orange", "תפוזים", "produce", r"^תפוז(ים)?( ברשת)?$", r"", 3, 15),
    ("f-clementine", "קלמנטינות", "produce", r"^קלמנטינ", r"", 3, 15),
    ("f-apple", "תפוח עץ (הזן הזול בסניף)", "produce", r"^תפוח עץ", r"אורגנ|סטורי|ברשת", 5, 25),
    ("f-grapes", "ענבים ירוקים", "produce", r"^ענב(ים)? (ירוק|לבן)", r"אורגנ", 10, 45),
    ("f-chickenbreast", "חזה עוף טרי", "meat", r"^(חזה|פילה) עוף", r"קפוא|שלם|חצוי|פרוס|\"יש\"|מעושן|מתובל", 25, 70),
    ("f-schnitzel", "שניצל עוף טרי", "meat", r"^שניצל(ון)? עוף", r"קפוא|שניצלוני|מתובל|פרימיום|בוטיק", 30, 70),
    ("f-thighs", "כרעיים עוף טריות", "meat", r"^כרעיים( עוף)?", r"קפוא|מתובל|מעושנ|בשום|איטלקי|בלי עור|מקוצב|\"יש\"", 15, 50),
    ("f-drumsticks", "שוקיים עוף טריות", "meat", r"^שוקיים( עוף)?", r"קפוא|הודו|בלי עור|\"יש\"", 15, 55),
    ("f-groundbeef", "בשר בקר טחון טרי", "meat", r"(בקר טחון|בשר( בקר)? טחון|טחון בקר|בשר טחון)", r"קפוא|עגל|הודו|עוף|צלעות", 45, 110),
]

# Keyword categorizer for packaged goods: ordered rules, first match wins.
# A category can appear more than once (an early rule claims items a later, broader rule would grab).
CATEGORY_NAMES = {
    "produce": "פירות וירקות", "meat": "בשר, עוף ודגים", "dairy": "חלב, גבינות וביצים", "bakery": "לחם ומאפים",
    "drinks": "משקאות", "snacks": "חטיפים ומתוקים", "pantry": "מזווה", "frozen": "קפואים",
    "cleaning": "ניקיון ובית", "care": "טיפוח ותינוקות", "pets": "חיות מחמד", "other": "שונות",
}
RULES = [
    ("produce", r"^(עגבני|מלפפון|פלפל |חסה|כרוב|גזר|בצל|שום |תפוח עץ|בננ|אבוקדו|לימון|תפוז|קלמנטינ|ענב|אגס|פטריות|נבטים|עשבי|פטרוזיליה|כוסברה|שמיר|נענע|סלק|קישוא|חציל|בטטה|תות|אוכמניות|מארז אוכמניות|מלון|אבטיח|עגבניות שרי)"),
    ("pets", r"כלב|חתול|גורים|דוגלי|ויסקס|פריסקיז|פדיגרי|בונזו|חול ל"),
    ("frozen", r"קפוא|מוקפא|גלידה|ארטיק|שלגון|בצק עלים|קרפלך|רביולי|כיסונ"),
    ("pantry", r"^מרק|אבקת מרק|ציר |^רוטב|^תערובת|^סירופ|תמצית|אצות|קוקטייל פירות|אננס|אפרס"),
    ("snacks", r"שוקולד|חטיף|במבה|ביסלי|ופל"),
    ("dairy", r"יוגורט|^גבינ"),
    ("cleaning", r"רצפות|קוטל|לילי |גלילים|מרכך (?!ל?שיער|נגד)"),
    ("care", r"תח\.ספיגה|תחתוני ספיגה|חיתול|האגיס|פמפרס|טיטולים|קרפרי|תחבושת|טמפון|מטרנה|סימילאק|תמ\"ל|שמפו|מרכך שיער|דאודורנט|משחת שיניים|מברשת שיניים|ג'ל רחצה|תחליב|גילוח|סכיני|קולגייט|אוראל|ניוואה|דאב |הד אנד|פינוק|מרכך ל?שיער|מרכך נגד|דאו |שפתון|שעווה|אולוויז|משחת|מרידול|אל תוש|קרם (ידיים|גוף|פנים|הגנה)|סבון (ידיים|גוף|נוזלי)|משייף|מסיר איפור|מי פה|צמר גפן|קיסמי"),
    ("cleaning", r"אקונומיקה|כביסה|מרכך כביסה|מדיח|ספוג|מגבונ|נייר טואלט|מגבות? נייר|סופר מגבת|שקיות|נייר אפיה|נייר כסף|רדיד|מטהר|מסיר|ניקוי|נוזל כלים|פרסיל|אריאל|סנו|פיניש|טישו|ממחטות|סבון כלים|אשפ|כוסות|צלחות|מזלגות|כפיות|מפיות|מטלית|גפרורים|ניקול|פיירי|XPO|נ\.רצפה|רצפות|סוללות|נרות|קיסמים|תבניות? אלומיניום|כלים חד"),
    ("meat", r"עוף|בקר|הודו|כבש(?!ים)|שניצל|נקניק|קבב|המבורגר|פסטרמה|סלמי|טונה|סרדינ|סלמון|דג |דגי|אמנון|לוקוס|נסיכת|הרינג|שרימפס|בשר|קציצות|מעדנות"),
    ("dairy", r"חלב|גבינ|^גב\.|^ג\.|יוגורט|יופלה|מעדן|^לבן |לבנה|קוטג|שמנת|חמאה|ביצים|ביצה|דנונ|אקטימל|מילקי|פודינג|צפתית|בולגרית|מוצרלה|פטה|ריקוטה|קפיר|פרמזן|פרמזנו|פקורינו|גאודה|עמק|נעם|גלבוע|קממבר|ברי |צ'דר|אמנטל|מסקרפונה|יטבתה|תנובה|שטראוס|דני |גו "),
    ("bakery", r"לחם|לחמני|פיתה|פיתות|בגט|חלה|חלות|טורטיה|מאפה|עוגה|עוגת|עוגיות|רוגלך|קרואסון|בורקס|מצה|קרקר|פריכיות|לחמית|בייגל|כעכים|ביסקוויט|וופל|טוסט"),
    ("drinks", r"מים |^מים|סודה|קולה|ספרייט|פאנטה|סבן אפ|מיץ|נקטר|משקה|^תה |חליטת|ליפטון|ויסוצקי|קפה|נס קפה|נספרסו|יין|בירה|וודקה|וויסקי|ליקר|ערק|פריגת|ספרינג|שוופס|אנרגיה|רד בול|נביעות|עין גדי|קפסול|שרדונה|קברנה|מרלו|סוביניון|רוזה|מוסקטו|למברוסקו|גולדסטאר|קרלסברג|הייניקן|סמוזי|פיוז טי|נסטי"),
    ("snacks", r"במבה|ביסלי|תפוצ|דוריטוס|ציפס|צ'יפס|חטיף|שוקולד|ש\.מריר|ש\.חלב|סוכרי|מסטיק|קליק|פסק זמן|מקופלת|קינדר|בונבונ|קרמבו|ממתק|גומי|לוטוס|אגוזי|פיצוח|גרעינ|שקדים|בוטנים|פופקורן|דגני|קורנפלקס|גרנולה|פיטנס|כריות|חלבה|ממרח|מנטוס|טוסו|מרציפן|בייגלה|גמייקה|סלים|ליציס|קינוח|מקדמיה|קשיו|פיסטוק|צימוק|פירות יבשים|תמרים|אגוז|טופי|מרשמלו|סוכריות|ריבת חלב|נוטלה|אפרופו|תפוציפס|צ'יטוס|פרינגלס"),
    ("pantry", r"אורז|פסטה|ספגטי|פנה|פתיתים|קמח|סוכר|מלח|שמן|חומץ|קטשופ|מיונז|חרדל|טחינה|חומוס|שעועית|עדשים|תירס|זיתים|מלפפונים|רסק|שימורי|תבלין|פפריקה|כמון|פלפל שחור|אבקת|שמרים|דבש|ריבה|קוסקוס|בורגול|קינואה|פירורי|אטריות|נודלס|רכז|קוקוס|וניל|סילאן|קנולה|גלטין|אפונ|שקשוקה|לקט|פטה|סלט|ממרח|מטבל|אנשובי|קפרי|רוטב|פסטו|ג'לי|פודינג|קורנפלור|סודה לשתיה|אבקת אפיה|לימון כבוש"),
]


def categorize(name):
    for key, rx in RULES:
        if re.search(rx, name, re.I):
            return key
    return "other"


def clean_name(n):
    n = re.sub(r"\*?מבצע\*?", "", n).replace("*", " ")
    return re.sub(r"\s+", " ", n).strip(" -")


def load_tsv(path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        p = line.split("\t")
        if len(p) < 8:
            continue
        try:
            price = float(p[2])
        except ValueError:
            continue
        if price <= 0:
            continue
        rows.append({"code": p[0].lstrip("0"), "name": clean_name(p[1]), "price": price,
                     "qty": p[3], "unit": p[4], "weighted": p[5] == "1", "maker": p[7].strip()})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "data.json"))
    ap.add_argument("--min-stores", type=int, default=3)
    a = ap.parse_args()

    stores, tables, skipped = [], [], []
    for chain, sid, chain_name, branch, addr, city, geo_q in STORES:
        try:
            p, info = download(chain, sid)
        except Exception as e:  # noqa: BLE001 - a store that didn't publish today is skipped, not fatal
            skipped.append(f"{chain_name} {branch}: {e}")
            print(f"skip {chain}:{sid} {e}", file=sys.stderr)
            continue
        g = geocode(geo_q or f"{addr}, {city}")
        approx = g is None
        g = g or geocode(f"{city}, ישראל")
        stores.append({"id": f"{chain}:{sid}", "chain": chain_name, "branch": branch, "address": f"{addr}, {city}",
                       "lat": g[0] if g else None, "lon": g[1] if g else None, "approx": approx})
        tables.append(load_tsv(p))
        print(f"ok   {chain}:{sid} {info}", file=sys.stderr)
    n = len(stores)

    # ---- packaged goods, matched by barcode ----
    by_code = {}
    for i, rows in enumerate(tables):
        for r in rows:
            if len(r["code"]) < 7 or r["weighted"]:
                continue
            e = by_code.setdefault(r["code"], {"names": [], "prices": [None] * n})
            if e["prices"][i] is None:
                e["prices"][i] = r["price"]
                e["names"].append(r["name"])
    products = []
    for code, e in by_code.items():
        have = [p for p in e["prices"] if p is not None]
        if len(have) < a.min_stores:
            continue
        med = statistics.median(have)
        # Drop prices that are clearly a unit or data-entry error (e.g. a case price on a single item).
        prices = [p if p is not None and med / 4 <= p <= med * 4 else None for p in e["prices"]]
        if sum(p is not None for p in prices) < a.min_stores:
            continue
        name = max(e["names"], key=len)
        products.append([code, name, categorize(name), 0, [None if p is None else round(p * 100) for p in prices], None])

    # ---- fresh items, matched by name rules, priced per kg ----
    for fid, label, cat, inc, exc, lo, hi in FRESH:
        prices, picks = [], []
        for rows in tables:
            cands = [r for r in rows if r["weighted"] and re.search(inc, r["name"])
                     and not (exc and re.search(exc, r["name"])) and lo <= r["price"] <= hi]
            best = min(cands, key=lambda r: r["price"], default=None)
            prices.append(None if best is None else round(best["price"] * 100))
            picks.append(None if best is None else best["name"])
        if sum(p is not None for p in prices) >= 2:
            products.append([fid, label, cat, 1, prices, picks])

    products.sort(key=lambda p: (p[3] == 0, -sum(x is not None for x in p[4]), p[1]))
    areas = []
    for name, q in AREAS:
        g = geocode(q)
        if g:
            areas.append({"name": name, "lat": g[0], "lon": g[1]})

    used = {p[2] for p in products}
    data = {
        "priceDate": datetime.datetime.strptime(TODAY, "%Y%m%d").date().isoformat(),
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
        "stores": stores,
        "skipped": skipped,
        "areas": areas,
        "categories": [{"id": k, "name": v} for k, v in CATEGORY_NAMES.items() if k in used],
        # [code, name, category, weighted(1 = price per kg), prices in agorot per store, matched names (fresh only)]
        "products": products,
    }
    Path(a.out).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {}
    for p in products:
        counts[p[2]] = counts.get(p[2], 0) + 1
    print(f"{len(products)} products, {n} stores -> {a.out} ({os.path.getsize(a.out) // 1024} KB)", file=sys.stderr)
    print(counts, file=sys.stderr)


if __name__ == "__main__":
    main()
