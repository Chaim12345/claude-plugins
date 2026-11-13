package il.salzol.go

import il.salzol.core.droid.Droid
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Go engine (core/droid). Every screen's data comes from here as JSON shaped for that screen;
 * calls run off the main thread. The classes below mirror core/app/views.go.
 */
object Go {
    suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    suspend fun status() = io { StatusView(JSONObject(Droid.status())) }
    suspend fun home() = io { HomeView(JSONObject(Droid.home())) }
    suspend fun product(code: String) = io { ProductView(JSONObject(Droid.product(code))) }
    suspend fun cart() = io { CartView(JSONObject(Droid.cart())) }
    suspend fun ai() = io { AIView(JSONObject(Droid.ai())) }
    suspend fun aiConfig() = io { JSONObject(Droid.aiConfig()) }

    suspend fun search(q: String, cat: String, sort: String, onSale: Boolean, il: Boolean, diet: String, offset: Int, limit: Int) = io {
        val req = JSONObject().put("q", q).put("cat", cat).put("sort", sort).put("onSale", onSale).put("il", il).put("diet", diet).put("offset", offset).put("limit", limit)
        SearchView(JSONObject(Droid.search(req.toString())))
    }

    suspend fun deals(cat: String, chain: String, onlyReal: Boolean, small: Boolean, sort: String, offset: Int, limit: Int) = io {
        val req = JSONObject().put("cat", cat).put("chain", chain).put("onlyReal", onlyReal).put("small", small).put("sort", sort).put("offset", offset).put("limit", limit)
        DealsView(JSONObject(Droid.deals(req.toString())))
    }

    suspend fun setQty(code: String, q: Double) = io { Droid.setQty(code, q).toInt() }
    suspend fun clearCart() = io { Droid.clearCart() }
    suspend fun toggleStore(id: String) = io { Droid.toggleStore(id) }
    suspend fun setClub(chain: String, on: Boolean) = io { Droid.setClub(chain, on) }
    suspend fun toggleWatch(code: String) = io { Droid.toggleWatch(code) }
    suspend fun setImages(on: Boolean) = io { Droid.setImages(on) }
    suspend fun setPlace(name: String, lat: Double, lon: Double, radius: Double) = io { Droid.setPlace(name, lat, lon, radius) }
    suspend fun sync() = io { Droid.sync() }
    suspend fun geocode(q: String) = io { JSONObject(Droid.geocode(q)) }

    suspend fun changes() = io { ChangesView(JSONObject(Droid.changes())) }
    suspend fun watched() = io { JSONArray(Droid.watched()).let { a -> (0 until a.length()).map { ItemView(a.getJSONObject(it)) } } }
    suspend fun lists() = io { JSONArray(Droid.lists()).let { a -> (0 until a.length()).map { ListView(a.getJSONObject(it)) } } }
    suspend fun analysis() = io { AnalysisView(JSONObject(Droid.analysis())) }
    suspend fun logText() = io { Droid.logText() }
    suspend fun cartText() = io { Droid.cartText() }
    suspend fun shop(storeId: String) = io { ShopView(JSONObject(Droid.shop(storeId))) }
    suspend fun setChecked(code: String, on: Boolean) = io { Droid.setChecked(code, on) }
    suspend fun saveList(name: String) = io { Droid.saveList(name) }
    suspend fun loadList(id: String, merge: Boolean) = io { Droid.loadList(id, merge) }
    suspend fun deleteList(id: String) = io { Droid.deleteList(id) }
    suspend fun parseList(text: String) = io { JSONArray(Droid.parseList(text)).let { a -> (0 until a.length()).map { ListMatch(a.getJSONObject(it)) } } }
    suspend fun addMany(items: Map<String, Double>) = io { Droid.addMany(JSONObject(items as Map<*, *>).toString()) }
    suspend fun lookup(barcode: String) = io { Droid.lookup(barcode) }

    suspend fun setAI(cfg: JSONObject) = io { Droid.setAI(cfg.toString()) }
    suspend fun testAI() = io { Droid.testAI() }
    suspend fun models() = io { JSONObject(Droid.models()) }
    suspend fun runEnrich() = io { Droid.runEnrich() }
    suspend fun runCheck() = io { Droid.runCheck() }
    suspend fun stopAI() = io { Droid.stopAI() }
    suspend fun clearAI() = io { Droid.clearAI() }
}

// ---------- JSON helpers ----------

fun JSONObject.s(k: String) = optString(k, "")
fun JSONObject.i(k: String) = optInt(k, 0)
fun JSONObject.d(k: String) = optDouble(k, 0.0)
fun JSONObject.b(k: String) = optBoolean(k, false)
fun <T> JSONObject.list(k: String, f: (JSONObject) -> T): List<T> {
    val a = optJSONArray(k) ?: return emptyList()
    return (0 until a.length()).map { f(a.getJSONObject(it)) }
}
fun JSONObject.strings(k: String): List<String> {
    val a: JSONArray = optJSONArray(k) ?: return emptyList()
    return (0 until a.length()).map { a.getString(it) }
}

// ---------- views (core/app/views.go) ----------

class StoreView(o: JSONObject) {
    val id = o.s("id"); val i = o.i("i"); val chain = o.s("chain"); val key = o.s("key"); val branch = o.s("branch")
    val on = o.b("on"); val km = o.d("km"); val club = o.b("club")
}

class Category(o: JSONObject) { val id = o.s("id"); val name = o.s("name") }

class Place(o: JSONObject) { val name = o.s("name"); val lat = o.d("lat"); val lon = o.d("lon"); val radius = o.d("radius") }

class AIRun(o: JSONObject) { val kind = o.s("kind"); val done = o.i("done"); val of = o.i("of"); val added = o.i("added"); val err = o.s("err"); val live = o.b("live") }

class StatusView(o: JSONObject) {
    val ready = o.b("ready"); val building = o.b("building")
    val place = o.optJSONObject("place")?.let { Place(it) }
    val syncing = o.b("syncing"); val syncMsg = o.s("syncMsg"); val syncErr = o.s("syncErr")
    val priceDate = o.s("priceDate"); val products = o.i("products")
    val stores = o.list("stores") { StoreView(it) }
    val cartCount = o.i("cartCount")
    val categories = o.list("categories") { Category(it) }
    val clubOwned: Set<String> = o.optJSONObject("clubOwned")?.let { c -> c.keys().asSequence().filter { c.optBoolean(it) }.toSet() } ?: emptySet()
    val aiOn = o.b("aiOn")
    val aiRun = o.optJSONObject("aiRun")?.let { AIRun(it) }
    val images = o.b("images")
}

class ItemView(o: JSONObject) {
    val code = o.s("code"); val name = o.s("name"); val price = o.s("price"); val lo = o.i("lo"); val where = o.s("where")
    val branches = o.i("branches"); val unit = o.s("unit"); val deal = o.s("deal"); val dealClub = o.b("dealClub")
    val qty = o.d("qty"); val weighted = o.b("weighted"); val img = o.s("img"); val stale = o.b("stale"); val gap = o.i("gap"); val tags = o.s("tags")
}

class LabelN(o: JSONObject) { val id = o.s("id"); val label = o.s("label"); val n = o.i("n") }

class SearchView(o: JSONObject) {
    val total = o.i("total"); val items = o.list("items") { ItemView(it) }; val diets = o.list("diets") { LabelN(it) }
}

class PriceRow(o: JSONObject) {
    val store = o.s("store"); val km = o.d("km"); val on = o.b("on"); val price = o.s("price"); val diff = o.s("diff"); val cheap = o.b("cheap")
    val stale = o.s("stale"); val chg = o.s("chg"); val deals = o.strings("deals"); val notes = o.strings("notes"); val dealAt = o.s("dealAt")
}

class ProductView(o: JSONObject) {
    val code = o.s("code"); val name = o.s("name"); val found = o.b("found"); val weighted = o.b("weighted"); val img = o.s("img")
    val facts = o.strings("facts"); val lo = o.s("lo"); val hi = o.s("hi"); val loWhere = o.s("loWhere"); val gapPct = o.i("gapPct")
    val best = o.s("best"); val rows = o.list("rows") { PriceRow(it) }; val qty = o.d("qty"); val watched = o.b("watched")
    val listed = o.strings("listed"); val odd = o.strings("odd")
}

class CartLine(o: JSONObject) {
    val code = o.s("code"); val name = o.s("name"); val qty = o.d("qty"); val weighted = o.b("weighted"); val cost = o.s("cost")
    val where = o.s("where"); val deal = o.s("deal"); val img = o.s("img")
}

class CartRow(o: JSONObject) {
    val storeId = o.s("storeId"); val lat = o.d("lat"); val lon = o.d("lon")
    val store = o.s("store"); val km = o.d("km"); val total = o.s("total"); val shelf = o.s("shelf"); val deals = o.i("deals")
    val missing = o.strings("missing"); val doubt = o.strings("doubt"); val best = o.b("best")
}

class CartView(o: JSONObject) {
    val count = o.i("count"); val lines = o.list("lines") { CartLine(it) }; val rows = o.list("rows") { CartRow(it) }
    val split = o.s("split"); val splitStores = o.i("splitStores"); val saving = o.s("saving"); val common = o.i("common")
}

class DealView(o: JSONObject) {
    val code = o.s("code"); val name = o.s("name"); val img = o.s("img"); val headline = o.s("headline"); val pct = o.i("pct")
    val price = o.s("price"); val was = o.s("was"); val terms = o.s("terms"); val where = o.s("where"); val end = o.s("end"); val soon = o.b("soon")
    val real = o.b("real"); val check = o.s("check"); val aiYes = o.b("aiYes"); val qty = o.i("qty"); val inCart = o.d("inCart"); val mine = o.b("mine")
}

class DealsView(o: JSONObject) {
    val total = o.i("total"); val items = o.list("items") { DealView(it) }; val best = o.list("best") { DealView(it) }
    val stockUp = o.list("stockUp") { DealView(it) }; val mine = o.list("mine") { DealView(it) }; val checked = o.i("checked")
    val chains = o.list("chains") { LabelN(it) }
}

class IndexRow(o: JSONObject) { val store = o.s("store"); val pct = o.i("pct"); val km = o.d("km") }

class HomeView(o: JSONObject) {
    val status = StatusView(o.optJSONObject("status") ?: JSONObject())
    val best = o.list("best") { DealView(it) }; val mine = o.list("mine") { DealView(it) }
    val regulars = o.list("regulars") { ItemView(it) }; val cheapest = o.list("cheapest") { IndexRow(it) }
    val cartTotal = o.s("cartTotal"); val cartWhere = o.s("cartWhere")
}

class PresetView(o: JSONObject) { val id = o.s("ID"); val label = o.s("Label"); val baseUrl = o.s("BaseURL"); val model = o.s("Model"); val keyUrl = o.s("KeyURL") }

class AIView(o: JSONObject) {
    val on = o.b("on"); val preset = o.s("preset"); val baseUrl = o.s("baseUrl"); val model = o.s("model"); val hasKey = o.b("hasKey"); val keyTail = o.s("keyTail")
    val enrichModel = o.s("enrichModel"); val enrichUses = o.s("enrichUses"); val enrichAuto = o.b("enrichAuto"); val dailyCap = o.i("dailyCap")
    val usedToday = o.i("usedToday"); val records = o.i("records"); val total = o.i("total")
    val verdicts: Map<String, Int> = o.optJSONObject("verdicts")?.let { v -> v.keys().asSequence().associateWith { v.optInt(it) } } ?: emptyMap()
    val run = o.optJSONObject("run")?.let { AIRun(it) }
    val presets = o.list("presets") { PresetView(it) }
}

class MoveView(o: JSONObject) {
    val code = o.s("code"); val name = o.s("name"); val store = o.s("store"); val from = o.s("from"); val to = o.s("to")
    val pct = o.i("pct"); val day = o.s("day"); val mine = o.b("mine"); val img = o.s("img")
}

class Notice(o: JSONObject) { val at = o.optLong("at"); val code = o.s("code"); val title = o.s("title"); val body = o.s("body") }

class ChangesView(o: JSONObject) {
    val down = o.list("down") { MoveView(it) }; val up = o.list("up") { MoveView(it) }; val total = o.i("total")
    val notices = o.list("notices") { Notice(it) }
}

class ListView(o: JSONObject) { val id = o.s("id"); val name = o.s("name"); val count = o.i("count"); val names = o.strings("names"); val at = o.s("at") }

class ShopItem(o: JSONObject) {
    val code = o.s("code"); val name = o.s("name"); val qty = o.d("qty"); val price = o.s("price"); val deal = o.s("deal")
    val checked = o.b("checked"); val stale = o.b("stale"); val img = o.s("img")
}

class ShopGroup(o: JSONObject) { val cat = o.s("cat"); val items = o.list("items") { ShopItem(it) } }

class ShopView(o: JSONObject) {
    val store = o.s("store"); val storeId = o.s("storeId"); val total = o.s("total"); val groups = o.list("groups") { ShopGroup(it) }
    val missing = o.strings("missing"); val done = o.i("done"); val of = o.i("of"); val lat = o.d("lat"); val lon = o.d("lon"); val address = o.s("address")
    val stores = o.list("stores") { LabelN(it) }
}

class ListMatch(o: JSONObject) {
    val line = o.s("line"); val qty = o.d("qty"); val code = o.s("code"); val name = o.s("name"); val price = o.s("price")
    val alts = o.list("alts") { LabelN(it) }
}

class BrandRow(o: JSONObject) { val brand = o.s("brand"); val n = o.i("n"); val types = o.i("types"); val pct = o.i("pct"); val own = o.b("own") }

class TypeRow(o: JSONObject) {
    val type = o.s("type"); val n = o.i("n"); val brands = o.i("brands"); val code = o.s("code"); val name = o.s("name")
    val unit = o.s("unit"); val savePct = o.i("savePct"); val median = o.s("median"); val where = o.s("where")
}

class AnalysisView(o: JSONObject) {
    val total = o.i("total"); val done = o.i("done"); val unsure = o.i("unsure"); val brandCount = o.i("brandCount"); val typeCount = o.i("typeCount")
    val cheap = o.list("cheap") { BrandRow(it) }; val dear = o.list("dear") { BrandRow(it) }; val own = o.list("own") { BrandRow(it) }
    val types = o.list("types") { TypeRow(it) }; val diets = o.list("diets") { LabelN(it) }
}
