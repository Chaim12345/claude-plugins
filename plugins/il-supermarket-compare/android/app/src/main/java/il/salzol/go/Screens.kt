package il.salzol.go

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import il.salzol.go.ui.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Re-read data whenever the engine reports something new (a sync, a new catalog, AI answers). */
@Composable
fun <T> engineState(vararg keys: Any?, load: suspend () -> T): T? {
    val tick by Bus.tick.collectAsState()
    var v by remember { mutableStateOf<T?>(null) }
    // a failed read (Go caught a panic and answered with an error object) leaves the last value: a
    // JSONException here would otherwise escape the effect and kill the app
    LaunchedEffect(tick, *keys) { runCatching { load() }.onSuccess { v = it }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it } }
    return v
}

// ---------------------------------------------------------------- home

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(nav: NavHostController) {
    val h = engineState { Go.home() }
    val scope = rememberCoroutineScope()
    val st = h?.status
    Column(Modifier.fillMaxSize()) {
        PlaceBar(nav, st)
        if (h == null || !h.status.ready) {
            Loading(if (st?.syncing == true) st.syncMsg.ifEmpty { "מוריד את המחירונים של היום…" } else "טוען את הקטלוג…")

        } else {
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                OutlinedButton(onClick = { nav.navigate("products") }, Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp)) {
                    Icon(Icons.Outlined.Search, null); Spacer(Modifier.width(8.dp)); Text("חיפוש מוצר: גבינה, במבה, חלב 3%…", color = P.ink2)
                }
            }
            if (h.cartTotal.isNotEmpty()) item {
                Panel(Modifier.clickable { nav.navigate("cart") }) {
                    Text("הסל שלכם", fontWeight = FontWeight.Bold, color = P.ink2, fontSize = 13.sp)
                    Text("הכי זול ב${h.cartWhere}: ${h.cartTotal} ₪", fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = P.ink)
                    Text("${h.status.cartCount} מוצרים · להשוואה המלאה", color = P.brand, fontSize = 13.sp)
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(Triple("מחירים שזזו", Icons.Outlined.TrendingDown, "changes"), Triple("המעקב שלי", Icons.Outlined.Visibility, "watch"), Triple("רשימות", Icons.Outlined.Bookmarks, "lists")).forEach { (label, icon, route) ->
                        Column(Modifier.weight(1f).background(P.surface, Round).clickable { nav.navigate(route) }.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(icon, null, tint = P.brand); Text(label, fontSize = 12.5.sp, color = P.ink, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            if (h.mine.isNotEmpty()) item { DealRow(nav, "במבצע ממה שאתם קונים", "מהסל, מהמוצרים הקבועים ומהמעקב", h.mine) }
            if (h.best.isNotEmpty()) item { DealRow(nav, "המבצעים הכי שווים השבוע", "הנחה אמיתית מול המחיר הרגיל הזול באזור", h.best) }
            if (h.cheapest.isNotEmpty()) item {
                Panel {
                    SectionHead("איזה סניף הכי זול", "מחירי אותם מוצרים מול המחיר הטיפוסי באזור")
                    h.cheapest.take(6).forEach { r ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(r.store, Modifier.weight(1f), fontSize = 14.sp, color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(if (r.pct <= 0) "זול ב־${-r.pct}%" else "יקר ב־${r.pct}%", fontWeight = FontWeight.Bold, color = if (r.pct <= 0) P.good else P.bad)
                        }
                    }
                }
            }
            if (h.regulars.isNotEmpty()) item {
                SectionHead("הקבועים שלי", "מוצרים שהוספתם לסל בעבר")
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    h.regulars.forEach { it2 -> ItemRow(it2, { nav.openProduct(it2.code) }) { q -> scope.launch { Go.setQty(it2.code, q); Bus.poke() } } }
                }
            }
            item {
                Panel {
                    SectionHead("קטגוריות")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        h.status.categories.forEach { c -> Chip(c.name, false) { nav.navigate("products?cat=${c.id}") } }
                    }
                }
            }
        }
    }
}
}

@Composable
fun DealRow(nav: NavHostController, title: String, sub: String, deals: List<DealView>) {
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // on the deals tab itself "all" would stack a second copy of the screen
        SectionHead(title, sub, "הכל") { nav.navigate("deals") { launchSingleTop = true } }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(deals, key = { it.code + it.where }) { d ->
                DealCard(d, 180.dp, { nav.openProduct(d.code) }) { scope.launch { Go.setQty(d.code, (d.inCart + d.qty)); Bus.poke() } }
            }
        }
    }
}

// ---------------------------------------------------------------- products

private val sorts = listOf("pop" to "פופולרי", "cheap" to "הכי זול", "unit" to "זול ליחידה", "gap" to "פער מחירים")

@Composable
fun ProductsScreen(nav: NavHostController, startCat: String) {
    var q by rememberSaveable { mutableStateOf("") }
    var dq by remember { mutableStateOf(q) }
    var cat by rememberSaveable { mutableStateOf(startCat) }
    var sort by rememberSaveable { mutableStateOf("pop") }
    var onSale by rememberSaveable { mutableStateOf(false) }
    var il by rememberSaveable { mutableStateOf(false) }
    var diet by rememberSaveable { mutableStateOf("") }
    val st = engineState { Go.status() }
    val tick by Bus.tick.collectAsState()
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<ItemView>>(emptyList()) }
    var total by remember { mutableIntStateOf(0) }
    var diets by remember { mutableStateOf<List<LabelN>>(emptyList()) }
    val list = rememberLazyListState()

    LaunchedEffect(q) { delay(if (q.isEmpty()) 0 else 180); dq = q } // search when typing pauses
    // gen changes whenever the rows are re-read: a page that was requested before is then stale and dropped
    var gen by remember { mutableIntStateOf(0) }
    var filterKey by remember { mutableStateOf("") }
    LaunchedEffect(dq, cat, sort, onSale, il, diet, tick) {
        val key = "$dq|$cat|$sort|$onSale|$il|$diet"
        // an event only refreshes what is loaded; a new search or filter starts again at 40 rows
        val limit = if (key == filterKey) maxOf(40, rows.size) else 40
        val r = Go.search(dq, cat, sort, onSale, il, diet, 0, limit)
        if (key != filterKey) { filterKey = key; runCatching { list.scrollToItem(0) } }
        gen++
        rows = r.items; total = r.total; diets = r.diets
    }
    // next page when the end of the list comes into view
    val nearEnd by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 } }
    LaunchedEffect(nearEnd) {
        if (nearEnd >= rows.size - 6 && rows.size < total) {
            val g = gen
            val more = Go.search(dq, cat, sort, onSale, il, diet, rows.size, 40).items
            if (g == gen) rows = (rows + more).distinctBy { it.code } // distinct: a duplicate key would crash the list
        }
    }
    val update: (String, Double) -> Unit = { code, qty ->
        scope.launch {
            Go.setQty(code, qty)
            Bus.poke() // the effect above re-reads the loaded rows
        }
    }

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.background(P.surface).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val ctx = androidx.compose.ui.platform.LocalContext.current
            var notFound by remember { mutableStateOf("") }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(q, { q = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text("חיפוש מוצר, יצרן או סוג") },
                    leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { if (q.isNotEmpty()) IconButton(onClick = { q = "" }) { Icon(Icons.Outlined.Close, "ניקוי") } })
                IconButton(onClick = {
                    scanBarcode(ctx) { code ->
                        scope.launch {
                            val found = Go.lookup(code)
                            if (found.isNotEmpty()) nav.openProduct(found) else notFound = "הברקוד $code לא נמכר בסניפים שבהשוואה"
                        }
                    }
                }) { Icon(Icons.Outlined.QrCodeScanner, "סריקת ברקוד", tint = P.ink) }
                IconButton(onClick = { nav.navigate("paste") }) { Icon(Icons.Outlined.ContentPaste, "הדבקת רשימה", tint = P.ink) }
            }
            if (notFound.isNotEmpty()) Hint(notFound, P.warn)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("הכל", cat.isEmpty()) { cat = "" }
                st?.categories?.forEach { c -> Chip(c.name, cat == c.id) { cat = if (cat == c.id) "" else c.id } }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("במבצע", onSale) { onSale = !onSale }
                Chip("תוצרת הארץ", il) { il = !il }
                diets.forEach { d -> Chip(d.label, diet == d.id) { diet = if (diet == d.id) "" else d.id } }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("מיון:", color = P.ink2, fontSize = 13.sp)
                sorts.forEach { (id, label) -> Chip(label, sort == id) { sort = id } }
            }
            Text("${"%,d".format(total)} מוצרים", color = P.ink2, fontSize = 13.sp)
        }
        LazyColumn(state = list, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(rows, key = { it.code }) { it2 -> ItemRow(it2, { nav.openProduct(it2.code) }) { qty -> update(it2.code, qty) } }
            if (rows.isEmpty() && st?.ready == true) item { Hint("לא מצאנו מוצר כזה. נסו מילה קצרה יותר, למשל ״קוטג״.") }
        }
    }
}

// ---------------------------------------------------------------- product sheet

@Composable
fun ProductScreen(nav: NavHostController, code: String) {
    val p = engineState(code) { Go.product(code) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(P.surface).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "חזרה") }
            Text("מחירים בכל הסניפים", fontWeight = FontWeight.Bold, color = P.ink, modifier = Modifier.weight(1f))
            val ctx = androidx.compose.ui.platform.LocalContext.current
            val askNotify = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) {}
            if (p != null && p.found) IconButton(onClick = {
                if (!p.watched && android.os.Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                    askNotify.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                scope.launch { Go.toggleWatch(code); Bus.poke() }
            }) {
                Icon(if (p.watched) Icons.Outlined.Visibility else Icons.Outlined.VisibilityOff, if (p.watched) "מפסיקים לעקוב" else "מעקב אחרי המחיר", tint = if (p.watched) P.brand else P.ink2)
            }
        }
        if (p == null) { Loading("טוען…") } else {
        if (!p.found) { Hint("המוצר לא נמצא במחירון הנוכחי.") } else {
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ProductImage(p.img, 96.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(p.name, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = P.ink)
                        p.facts.forEach { Text(it, fontSize = 12.5.sp, color = P.ink2) }
                    }
                }
            }
            if (p.lo.isNotEmpty() && p.gapPct > 0) item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Panel(Modifier.weight(1f)) { Text("הכי זול", color = P.ink2, fontSize = 12.sp); Text("${p.lo} ₪", fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = P.good); Text(p.loWhere, fontSize = 12.sp, color = P.ink2, maxLines = 1) }
                    Panel(Modifier.weight(1f)) { Text("הכי יקר", color = P.ink2, fontSize = 12.sp); Text("${p.hi} ₪", fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = P.ink); Text("+${p.gapPct}% מהזול", fontSize = 12.sp, color = P.warn) }
                }
            }
            if (p.best.isNotEmpty()) item { Text(p.best, Modifier.fillMaxWidth().background(P.bad.copy(alpha = 0.08f), Round).padding(12.dp), color = P.ink, fontWeight = FontWeight.SemiBold) }
            if (p.listed.isNotEmpty() || p.odd.isNotEmpty()) item {
                Panel {
                    if (p.listed.isNotEmpty()) Hint("רשום בלי מחיר במחירון של: " + p.listed.joinToString(", "))
                    p.odd.forEach { Hint("מחיר חריג: $it", P.warn) }
                }
            }
            items(p.rows) { r ->
                Column(Modifier.fillMaxWidth().background(P.surface, Round).padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(r.store, fontWeight = FontWeight.Bold, color = if (r.on) P.ink else P.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (r.km >= 0) Text("${r.km} ק״מ${if (!r.on) " · לא בהשוואה" else ""}", fontSize = 12.sp, color = P.ink2)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("${r.price} ₪", fontWeight = FontWeight.ExtraBold, color = if (r.cheap) P.good else P.ink, fontSize = 16.sp)
                            if (r.diff.isNotEmpty()) Text(r.diff, fontSize = 12.sp, color = P.ink2)
                            if (r.dealAt.isNotEmpty()) Text(r.dealAt, fontSize = 12.sp, color = P.bad, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (r.stale.isNotEmpty()) Badge(r.stale, P.warn)
                    if (r.chg.isNotEmpty()) Text(r.chg, fontSize = 12.sp, color = P.ink2)
                    r.deals.forEach { Text("מבצע: $it", fontSize = 12.sp, color = P.bad) }
                    r.notes.forEach { Text("בתנאי: $it", fontSize = 12.sp, color = P.ink2) }
                }
            }
        }
        Row(Modifier.fillMaxWidth().background(P.surface).padding(12.dp), horizontalArrangement = Arrangement.Center) {
            if (p.qty > 0) Stepper(p.qty, p.weighted) { q -> scope.launch { Go.setQty(code, q); Bus.poke() } }
            else Button(onClick = { scope.launch { Go.setQty(code, if (p.weighted) 0.5 else 1.0); Bus.poke() } }, Modifier.fillMaxWidth().height(48.dp)) { Text("הוספה לסל", fontWeight = FontWeight.Bold) }
        }
    }
}
}
}

// ---------------------------------------------------------------- cart

@Composable
fun CartScreen(nav: NavHostController) {
    val c = engineState { Go.cart() }
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(P.surface).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Title("הסל", Modifier.weight(1f))
            if ((c?.count ?: 0) > 0) TextButton(onClick = { confirm = true }) { Text("ריקון הסל", color = P.bad) }
        }
        if (c == null) { Loading("טוען…") } else {
        if (c.count == 0) {
            Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("הסל ריק", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = P.ink)
                Hint("הוסיפו מוצרים ונשווה את הסל בכל הסניפים שסביבכם.")
                Spacer(Modifier.height(12.dp))
                Button(onClick = { nav.navigate("products") }) { Text("חיפוש מוצרים") }
            }

        } else {
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                val best = c.rows.firstOrNull()
                Column(Modifier.fillMaxWidth().background(P.brand, Round).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (best != null) {
                        Text("הכי זול לסל הזה", color = P.brandInk, fontSize = 13.sp)
                        Text(best.store, color = P.brandInk, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                        Text("${best.total} ₪" + if (best.missing.isNotEmpty()) " · חסרים ${best.missing.size}" else "", color = P.brandInk, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                    }
                    if (c.saving.isNotEmpty()) Text("חוסכים ${c.saving} ₪ מול הסניף היקר", color = P.brandInk, fontSize = 13.sp)
                    if (c.splitStores > 1) Text("קנייה בכל מוצר בסניף הזול שלו: ${c.split} ₪ ב־${c.splitStores} סניפים", color = P.brandInk, fontSize = 13.sp)
                }
            }
            item {
                val ctx = androidx.compose.ui.platform.LocalContext.current
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { nav.navigate("shop?store=") }, Modifier.weight(1f).height(48.dp)) { Icon(Icons.Outlined.Checklist, null); Spacer(Modifier.width(6.dp)); Text("יוצאים לקנות", fontWeight = FontWeight.Bold) }
                    OutlinedIconButton(onClick = { scope.launch { shareText(ctx, Go.cartText(), "שיתוף הרשימה") } }, Modifier.size(48.dp)) { Icon(Icons.Outlined.Share, "שיתוף") }
                    OutlinedIconButton(onClick = { nav.navigate("lists") }, Modifier.size(48.dp)) { Icon(Icons.Outlined.BookmarkAdd, "שמירה כרשימה") }
                }
            }
            item { SectionHead("לפי סניף", "מבצעים נספרים; סניף שחסרים בו מוצרים מופיע בהמשך") }
            items(c.rows) { r ->
                Column(Modifier.fillMaxWidth().background(P.surface, Round).padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(r.store, fontWeight = FontWeight.Bold, color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text((if (r.km >= 0) "${r.km} ק״מ · " else "") + (if (r.deals > 0) "${r.deals} במבצע" else "בלי מבצעים"), fontSize = 12.sp, color = P.ink2)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("${r.total} ₪", fontWeight = FontWeight.ExtraBold, color = if (r.best) P.good else P.ink, fontSize = 17.sp)
                            if (r.shelf != r.total) Text("${r.shelf} ₪ בלי מבצעים", fontSize = 11.5.sp, color = P.ink2)
                        }
                    }
                    if (r.missing.isNotEmpty()) Hint("חסרים: " + r.missing.joinToString(", "), P.warn)
                    if (r.doubt.isNotEmpty()) Hint("אולי לא על המדף: " + r.doubt.joinToString(", "), P.ink2)
                    val ctx = androidx.compose.ui.platform.LocalContext.current
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { nav.navigate("shop?store=" + android.net.Uri.encode(r.storeId)) }) { Text("קונים כאן", color = P.brand) }
                        if (r.lat != 0.0) TextButton(onClick = { navigateTo(ctx, r.lat, r.lon, r.store) }) { Text("ניווט", color = P.brand) }
                    }
                }
            }
            item { SectionHead("המוצרים", "כל מוצר והסניף הזול שלו") }
            items(c.lines, key = { it.code }) { l ->
                Row(Modifier.fillMaxWidth().background(P.surface, Round).clickable { nav.openProduct(l.code) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ProductImage(l.img, 52.dp)
                    Column(Modifier.weight(1f)) {
                        Text(l.name, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = P.ink)
                        Text(l.where + if (l.deal.isNotEmpty()) " · ${l.deal}" else "", fontSize = 12.sp, color = P.ink2, maxLines = 1)
                        if (l.cost.isNotEmpty()) Text("${l.cost} ₪", fontWeight = FontWeight.Bold, color = P.ink)
                    }
                    Stepper(l.qty, l.weighted) { q -> scope.launch { Go.setQty(l.code, q); Bus.poke() } }
                }
            }
        }
    }
}
}
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("לרוקן את הסל?") },
        confirmButton = { TextButton(onClick = { confirm = false; scope.launch { Go.clearCart(); Bus.poke() } }) { Text("ריקון", color = P.bad) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("ביטול") } })
}

// ---------------------------------------------------------------- deals

private val dealSorts = listOf("useful" to "הכי שווה לכם", "save" to "חיסכון ב־₪", "pct" to "אחוז הנחה", "ending" to "נגמר בקרוב")

@Composable
fun DealsScreen(nav: NavHostController) {
    var cat by rememberSaveable { mutableStateOf("") }
    var chain by rememberSaveable { mutableStateOf("") }
    var onlyReal by rememberSaveable { mutableStateOf(true) }
    var sort by rememberSaveable { mutableStateOf("useful") }
    val st = engineState { Go.status() }
    val tick by Bus.tick.collectAsState()
    val scope = rememberCoroutineScope()
    var view by remember { mutableStateOf<DealsView?>(null) }
    var rows by remember { mutableStateOf<List<DealView>>(emptyList()) }
    val list = rememberLazyListState()
    var gen by remember { mutableIntStateOf(0) } // changes on every re-read: an older page request is dropped
    var filterKey by remember { mutableStateOf("") }
    LaunchedEffect(cat, chain, onlyReal, sort, tick) {
        val key = "$cat|$chain|$onlyReal|$sort"
        val limit = if (key == filterKey) maxOf(30, rows.size) else 30 // an event refreshes what is loaded
        val v = Go.deals(cat, chain, onlyReal, false, sort, 0, limit)
        if (key != filterKey) { filterKey = key; runCatching { list.scrollToItem(0) } }
        gen++
        view = v; rows = v.items
    }
    // the last visible item index is a list position (headers and two-card rows), not a deal count
    val nearEnd by remember { derivedStateOf { val i = list.layoutInfo; (i.visibleItemsInfo.lastOrNull()?.index ?: 0) >= i.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd, rows.size) {
        val v = view ?: return@LaunchedEffect
        if (nearEnd && rows.size < v.total) {
            val g = gen
            val more = Go.deals(cat, chain, onlyReal, false, sort, rows.size, 30).items
            if (g == gen && more.isNotEmpty()) rows = (rows + more).distinctBy { it.code + "|" + it.where }
        }
    }
    val v = view
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(P.surface).padding(14.dp)) { Title("מבצעים") }
        if (v == null) { Loading("מסדר את המבצעים מכל הסניפים…") } else {
        val add: (DealView) -> Unit = { d -> scope.launch { Go.setQty(d.code, d.inCart + d.qty); Bus.poke() } }
        LazyColumn(state = list, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Hint("כל חיסכון נמדד מול המחיר הרגיל הזול ביותר בסניפים שסביבכם, לכמות שהמבצע דורש." +
                    if (v.checked > 0) " ${"%,d".format(v.checked)} מבצעים מסומנים ״לבדוק בקופה״." else "")
            }
            if (cat.isEmpty() && chain.isEmpty()) {
                if (v.mine.isNotEmpty()) item { DealRow(nav, "במבצע ממה שאתם קונים", "", v.mine) }
                if (v.stockUp.isNotEmpty()) item { DealRow(nav, "שווה להצטייד", "מוצרים שמחזיקים מעמד, 20% ומעלה מתחת למחיר הרגיל", v.stockUp) }
                if (v.best.isNotEmpty()) item { DealRow(nav, "ההנחות העמוקות", "הנחה אמיתית, שלוש לכל קטגוריה לכל היותר", v.best) }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SectionHead("כל המבצעים", "${"%,d".format(v.total)} מבצעים")
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("כל הקטגוריות", cat.isEmpty()) { cat = "" }
                        st?.categories?.forEach { c -> Chip(c.name, cat == c.id) { cat = if (cat == c.id) "" else c.id } }
                    }
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("כל הרשתות", chain.isEmpty()) { chain = "" }
                        v.chains.forEach { c -> Chip(c.label, chain == c.id) { chain = if (chain == c.id) "" else c.id } }
                    }
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("רק הנחה אמיתית", onlyReal) { onlyReal = !onlyReal }
                        dealSorts.forEach { (id, label) -> Chip(label, sort == id) { sort = id } }
                    }
                }
            }
            itemsIndexed(rows.chunked(2), key = { i, _ -> i }) { _, pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    pair.forEach { d -> Box(Modifier.weight(1f)) { DealCard(d, null, { nav.openProduct(d.code) }) { add(d) } } }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}
}
