package il.salzol.go

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.navigation.NavHostController
import il.salzol.go.ui.*
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- helpers

/** Opens Waze, Google Maps or any navigation app at a branch. */
fun navigateTo(ctx: Context, lat: Double, lon: Double, label: String) {
    if (lat == 0.0 && lon == 0.0) return
    val uri = Uri.parse("geo:$lat,$lon?q=$lat,$lon(${Uri.encode(label)})")
    runCatching { ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW, uri), "ניווט לסניף")) }
}

fun shareText(ctx: Context, text: String, title: String = "שיתוף") {
    if (text.isBlank()) return
    ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), title))
}

private const val CHANNEL = "prices"

/** Posts the engine's notices (watched products that got cheaper). */
fun postNotices(ctx: Context, json: String) {
    val a = runCatching { org.json.JSONArray(json) }.getOrNull() ?: return
    if (a.length() == 0) return
    if (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "ירידות מחיר", NotificationManager.IMPORTANCE_DEFAULT))
    for (k in 0 until a.length()) {
        val n = Notice(a.getJSONObject(k))
        val open = PendingIntent.getActivity(ctx, k, Intent(ctx, MainActivity::class.java).putExtra("product", n.code).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_more).setContentTitle(n.title).setContentText(n.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body)).setContentIntent(open).setAutoCancel(true).build()
        runCatching { NotificationManagerCompat.from(ctx).notify(n.code.hashCode(), b) }
    }
}

// ---------------------------------------------------------------- price changes

@Composable
fun ChangesScreen(nav: NavHostController) {
    val v = engineState { Go.changes() }
    var tab by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        Header(nav, "מחירים שזזו")
        if (v == null) Loading("טוען…") else {
            TabRow(tab, containerColor = P.surface) {
                Tab(tab == 0, { tab = 0 }, text = { Text("הוזלו (${v.down.size})") })
                Tab(tab == 1, { tab = 1 }, text = { Text("התייקרו (${v.up.size})") })
            }
            LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (v.notices.isNotEmpty() && tab == 0) item {
                    Panel {
                        Text("מה חדש במעקב שלכם", fontWeight = FontWeight.Bold, color = P.ink)
                        v.notices.take(5).forEach { n -> Text("• ${n.title}: ${n.body}", fontSize = 13.sp, color = P.ink, modifier = Modifier.clickable { nav.openProduct(n.code) }) }
                    }
                }
                if (v.total == 0) item { Hint("עוד אין שינויים: הם מופיעים מהעדכון השני של המחירים והלאה (נשמרים 30 יום).") }
                items(if (tab == 0) v.down else v.up) { m ->
                    Row(Modifier.fillMaxWidth().background(P.surface, Round).clickable { nav.openProduct(m.code) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ProductImage(m.img, 48.dp)
                        Column(Modifier.weight(1f)) {
                            Text(m.name, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = P.ink)
                            Text(m.store + (if (m.mine) " · שלכם" else ""), fontSize = 12.sp, color = P.ink2, maxLines = 1)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("${m.to} ₪", fontWeight = FontWeight.ExtraBold, color = if (m.pct < 0) P.good else P.bad)
                            Text("${m.from} ₪", fontSize = 12.sp, color = P.ink2, textDecoration = TextDecoration.LineThrough)
                            Text((if (m.pct > 0) "+" else "") + "${m.pct}%", fontSize = 12.sp, color = if (m.pct < 0) P.good else P.bad, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- watch list

@Composable
fun WatchScreen(nav: NavHostController) {
    val l = engineState { Go.watched() }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Header(nav, "המעקב שלי")
        if (l == null) Loading("טוען…") else LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Hint("נודיע כשמוצר שאתם עוקבים אחריו מוזל באחד הסניפים שבהשוואה. להוספה: העין בדף המוצר.") }
            if (l.isEmpty()) item { Hint("עוד לא עוקבים אחרי מוצרים.") }
            items(l, key = { it.code }) { it2 -> ItemRow(it2, { nav.openProduct(it2.code) }) { q -> scope.launch { Go.setQty(it2.code, q); Bus.poke() } } }
        }
    }
}

// ---------------------------------------------------------------- saved lists

@Composable
fun ListsScreen(nav: NavHostController) {
    val l = engineState { Go.lists() }
    val st = engineState { Go.status() }
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Header(nav, "רשימות שמורות")
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if ((st?.cartCount ?: 0) > 0) item {
                Panel {
                    Text("שמירת הסל הנוכחי (${st?.cartCount} מוצרים)", fontWeight = FontWeight.Bold, color = P.ink)
                    OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("שם, למשל ״קניות שבועיות״") })
                    Button(onClick = { scope.launch { Go.saveList(name); name = ""; Bus.poke() } }, Modifier.fillMaxWidth()) { Text("שמירה") }
                }
            }
            if (l?.isEmpty() == true) item { Hint("עוד אין רשימות. שמרו את הסל כרשימה לשבוע הבא.") }
            items(l ?: emptyList(), key = { it.id }) { x ->
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(x.name, fontWeight = FontWeight.Bold, color = P.ink)
                            Text("${x.count} מוצרים · ${x.at}", fontSize = 12.sp, color = P.ink2)
                        }
                        IconButton(onClick = { scope.launch { Go.deleteList(x.id); Bus.poke() } }) { Icon(Icons.Outlined.Delete, "מחיקה", tint = P.ink2) }
                    }
                    if (x.names.isNotEmpty()) Text(x.names.joinToString(" · "), fontSize = 12.5.sp, color = P.ink2, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { scope.launch { Go.loadList(x.id, false); Bus.poke(); nav.navigate("cart") } }) { Text("לסל במקום הנוכחי") }
                        OutlinedButton(onClick = { scope.launch { Go.loadList(x.id, true); Bus.poke(); nav.navigate("cart") } }) { Text("להוסיף לסל") }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- in-store checklist

@Composable
fun ShopScreen(nav: NavHostController, startStore: String) {
    var storeId by remember { mutableStateOf(startStore) }
    val v = engineState(storeId) { Go.shop(storeId) }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pick by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Header(nav, "יוצאים לקנות")
        if (v == null) Loading("טוען…") else LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Column(Modifier.fillMaxWidth().background(P.brand, Round).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(v.store, color = P.brandInk, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
                    if (v.address.isNotEmpty()) Text(v.address, color = P.brandInk, fontSize = 13.sp)
                    Text("${v.total} ₪ · סומנו ${v.done} מתוך ${v.of}", color = P.brandInk, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    LinearProgressIndicator(progress = { if (v.of > 0) v.done.toFloat() / v.of else 0f }, Modifier.fillMaxWidth(), color = P.tag, trackColor = P.brandInk.copy(alpha = 0.3f))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = { navigateTo(ctx, v.lat, v.lon, v.store) }) { Icon(Icons.Outlined.Directions, null); Spacer(Modifier.width(4.dp)); Text("ניווט") }
                        FilledTonalButton(onClick = { pick = true }) { Text("סניף אחר") }
                    }
                }
            }
            if (v.missing.isNotEmpty()) item { Hint("לא נמכר בסניף הזה: " + v.missing.joinToString(", "), P.warn) }
            v.groups.forEach { g ->
                item { Text(g.cat, fontWeight = FontWeight.ExtraBold, color = P.ink2, fontSize = 14.sp) }
                items(g.items, key = { it.code }) { it2 ->
                    Row(Modifier.fillMaxWidth().background(P.surface, Round).clickable { scope.launch { Go.setChecked(it2.code, !it2.checked); Bus.poke() } }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Checkbox(it2.checked, { on -> scope.launch { Go.setChecked(it2.code, on); Bus.poke() } })
                        Column(Modifier.weight(1f)) {
                            Text(it2.name, fontWeight = FontWeight.SemiBold, color = if (it2.checked) P.ink2 else P.ink, textDecoration = if (it2.checked) TextDecoration.LineThrough else null, maxLines = 2)
                            Text("× ${fmtQty(it2.qty)}" + (if (it2.deal.isNotEmpty()) " · מבצע ${it2.deal}" else "") + (if (it2.stale) " · אולי לא על המדף" else ""), fontSize = 12.sp, color = P.ink2)
                        }
                        Text("${it2.price} ₪", fontWeight = FontWeight.Bold, color = P.ink)
                    }
                }
            }
        }
    }
    if (pick && v != null) AlertDialog(onDismissRequest = { pick = false }, title = { Text("באיזה סניף?") }, confirmButton = {}, text = {
        Column { v.stores.forEach { s -> TextButton(onClick = { storeId = s.id; pick = false }) { Text(s.label) } } }
    })
}

// ---------------------------------------------------------------- paste a shopping list

@Composable
fun PasteScreen(nav: NavHostController) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var matches by remember { mutableStateOf<List<ListMatch>>(emptyList()) }
    val chosen = remember { mutableStateMapOf<Int, String>() } // line -> code
    val on = remember { mutableStateMapOf<Int, Boolean>() }
    Column(Modifier.fillMaxSize()) {
        Header(nav, "הדבקת רשימת קניות")
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Panel {
                    Hint("שורה לכל מוצר, אפשר עם כמות: ״2 חלב 3%״, ״במבה x3״. נמצא לכל שורה את המוצר הנפוץ ביותר, ותוכלו להחליף.")
                    OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(min = 140.dp), placeholder = { Text("חלב\nלחם אחיד\n2 במבה") })
                    Button(onClick = { scope.launch { matches = Go.parseList(text); chosen.clear(); on.clear(); matches.forEachIndexed { i, m -> if (m.code.isNotEmpty()) { chosen[i] = m.code; on[i] = true } } } },
                        Modifier.fillMaxWidth(), enabled = text.isNotBlank()) { Text("חיפוש המוצרים") }
                }
            }
            itemsIndexed(matches) { i, m ->
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(on[i] == true, { on[i] = it }, enabled = m.code.isNotEmpty())
                        Column(Modifier.weight(1f)) {
                            Text("״${m.line}″ × ${fmtQty(m.qty)}", fontSize = 12.5.sp, color = P.ink2)
                            if (m.code.isEmpty()) Text("לא נמצא", color = P.warn, fontWeight = FontWeight.Bold)
                            else {
                                val alt = m.alts.firstOrNull { it.id == chosen[i] }
                                Text(alt?.label ?: "${m.name} · ${m.price} ₪", fontWeight = FontWeight.SemiBold, color = P.ink)
                            }
                        }
                    }
                    if (m.alts.isNotEmpty()) FlowRowCompat {
                        Chip(m.name.take(22), chosen[i] == m.code) { chosen[i] = m.code }
                        m.alts.forEach { a -> Chip(a.label.substringBefore(" · ").take(22), chosen[i] == a.id) { chosen[i] = a.id } }
                    }
                }
            }
            if (matches.any { it.code.isNotEmpty() }) item {
                Button(onClick = {
                    val add = matches.indices.filter { on[it] == true && chosen[it] != null }.associate { chosen[it]!! to matches[it].qty }
                    scope.launch { Go.addMany(add); Bus.poke(); nav.navigate("cart") }
                }, Modifier.fillMaxWidth().height(50.dp)) { Text("הוספה לסל (${matches.indices.count { on[it] == true }})", fontWeight = FontWeight.Bold) }
            }
        }
    }
}

// ---------------------------------------------------------------- analysis

@Composable
fun AnalysisScreen(nav: NavHostController) {
    val a = engineState { Go.analysis() }
    var shown by remember { mutableIntStateOf(25) }
    Column(Modifier.fillMaxSize()) {
        Header(nav, "ניתוח נתונים")
        if (a == null) Loading("מנתח…") else LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Panel {
                    Hint("כל השוואה נעשית בתוך אותו סוג מוצר ולפי מחיר ליחידה, במחיר הזול בסניפים שבחרתם: מותג גבינות נמדד מול גבינות.")
                    Text("סווגו ${"%,d".format(a.done)} מתוך ${"%,d".format(a.total)} מוצרים · ${a.typeCount} סוגים · ${a.brandCount} מותגים", fontSize = 13.sp, color = P.ink)
                    if (a.done < a.total) TextButton(onClick = { nav.navigate("ai") }) { Text("לסיווג שאר המוצרים", color = P.brand) }
                }
            }
            if (a.own.isNotEmpty()) item { BrandPanel("מותג פרטי מול מותגים", "כמה זול המותג של הרשת מהמותגים הארציים מאותו סוג (חציון)", a.own) { if (it.pct >= 0) "זול ב־${it.pct}%" to P.good else "יקר ב־${-it.pct}%" to P.bad } }
            if (a.cheap.isNotEmpty()) item { BrandPanel("מותגים זולים מהרגיל", "מול מוצר טיפוסי מאותו סוג, ממוצע על כל מוצרי המותג", a.cheap) { "${it.pct}%" to P.good } }
            if (a.dear.isNotEmpty()) item { BrandPanel("מותגים יקרים מהרגיל", "כמה יותר משלמים על המותג", a.dear) { "+${it.pct}%" to P.bad } }
            if (a.types.isNotEmpty()) item { SectionHead("הכי זול ליחידה בכל סוג מוצר", "הסוגים הגדולים קודם") }
            items(a.types.take(shown)) { t ->
                Column(Modifier.fillMaxWidth().background(P.surface, Round).clickable { nav.openProduct(t.code) }.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row { Text(t.type, Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, color = P.ink); Text("${t.n} מוצרים · ${t.brands} מותגים", fontSize = 12.sp, color = P.ink2) }
                    Text(t.name, fontSize = 13.5.sp, color = P.ink, maxLines = 2)
                    Text(t.unit + (if (t.savePct > 0) " · ${t.savePct}% מתחת לחציון" else "") + " · חציון ${t.median} ₪", fontSize = 12.5.sp, color = P.good, fontWeight = FontWeight.Bold)
                    Text(t.where, fontSize = 12.sp, color = P.ink2)
                }
            }
            if (a.types.size > shown) item { OutlinedButton(onClick = { shown += 25 }, Modifier.fillMaxWidth()) { Text("עוד סוגים (${a.types.size - shown})") } }
            if (a.done == 0) item { Hint("עוד אין מוצרים מסווגים. הגדירו מפתח AI ואפשרו סיווג.") }
        }
    }
}

@Composable
private fun BrandPanel(title: String, sub: String, rows: List<BrandRow>, value: @Composable (BrandRow) -> Pair<String, androidx.compose.ui.graphics.Color>) {
    Panel {
        SectionHead(title, sub)
        rows.forEach { r ->
            val (t, c) = value(r)
            Row(Modifier.fillMaxWidth()) {
                Text("${r.brand} (${r.n} מוצרים)" + if (r.own && title.startsWith("מותגים")) " · פרטי" else "", Modifier.weight(1f), fontSize = 13.5.sp, color = P.ink, maxLines = 1)
                Text(t, fontWeight = FontWeight.Bold, color = c)
            }
        }
    }
}

// ---------------------------------------------------------------- diagnostic log

@Composable
fun LogScreen(nav: NavHostController) {
    val text = engineState { Go.logText() }
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize()) {
        Header(nav, "יומן אבחון")
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { shareText(ctx, text ?: "", "שליחת היומן") }) { Icon(Icons.Outlined.Share, null); Spacer(Modifier.width(6.dp)); Text("שיתוף") }
        }
        Hint("  מה קרה בעדכוני המחירים, בגילוי סניפים וב־AI. אין כאן מידע אישי מלבד המיקום שבחרתם.")
        LazyColumn(Modifier.fillMaxSize().padding(12.dp).background(P.surface, Round).padding(8.dp)) {
            item {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    Text(text ?: "", fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = P.ink)
                }
            }
        }
    }
}
