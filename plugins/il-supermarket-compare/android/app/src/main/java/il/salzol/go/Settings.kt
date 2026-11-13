package il.salzol.go

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.navigation.NavHostController
import il.salzol.go.ui.*
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun Header(nav: NavHostController, title: String) {
    Row(Modifier.fillMaxWidth().background(P.surface).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "חזרה") }
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = P.ink)
    }
}

// ---------------------------------------------------------------- more

@Composable
fun MoreScreen(nav: NavHostController) {
    val st = engineState { Go.status() }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(P.surface).padding(14.dp)) { Title("עוד") }
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { MoreRow(Icons.Outlined.Place, "מיקום", st?.place?.name?.let { "$it · ${st.place?.radius?.toInt()} ק״מ" } ?: "בחירת מיקום") { nav.navigate("location") } }
            item { MoreRow(Icons.Outlined.Storefront, "סניפים וכרטיסי מועדון", "${st?.stores?.count { it.on } ?: 0} מתוך ${st?.stores?.size ?: 0} סניפים בהשוואה") { nav.navigate("stores") } }
            item { MoreRow(Icons.Outlined.Visibility, "המעקב שלי", "מוצרים שאתם עוקבים אחריהם, והתראה כשהם מוזלים") { nav.navigate("watch") } }
            item { MoreRow(Icons.Outlined.TrendingDown, "מחירים שזזו", "מה הוזל ומה התייקר מאז העדכונים הקודמים") { nav.navigate("changes") } }
            item { MoreRow(Icons.Outlined.Bookmarks, "רשימות שמורות", "שמרו את הסל לשבוע הבא") { nav.navigate("lists") } }
            item { MoreRow(Icons.Outlined.Analytics, "ניתוח נתונים", "מותגים זולים ויקרים, מותג פרטי, הכי זול ליחידה בכל סוג") { nav.navigate("analysis") } }
            item {
                val run = st?.aiRun
                MoreRow(Icons.Outlined.AutoAwesome, "בינה מלאכותית", when {
                    run?.live == true -> if (run.kind == "enrich") "מסווג מוצרים: ${run.done}/${run.of}" else "בודק מבצעים: ${run.done}/${run.of}"
                    st?.aiOn == true -> "פעיל: סיווג מוצרים ובדיקת מבצעים"
                    else -> "מפתח Gemini חינמי או כל ספק תואם OpenAI"
                }) { nav.navigate("ai") }
            }
            item {
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("תמונות מוצרים", Modifier.weight(1f), fontWeight = FontWeight.Bold, color = P.ink)
                        Switch(st?.images ?: true, { on -> scope.launch { Go.setImages(on); Bus.poke() } })
                    }
                    Hint("התמונות נטענות מאתרי הרשתות.")
                }
            }
            item { MoreRow(Icons.Outlined.BugReport, "יומן אבחון", "מה קרה בעדכוני המחירים, לשיתוף כשמשהו לא עובד") { nav.navigate("log") } }
            item {
                Panel {
                    Text("על המחירים", fontWeight = FontWeight.Bold, color = P.ink)
                    Hint("המחירים מהמחירונים הרשמיים שהרשתות מפרסמות לפי חוק המזון (שקיפות מחירים). המחירון האחרון: ${st?.priceDate ?: "—"}. ייתכנו הבדלים מהמחיר בקופה.")
                    Hint("סל זול 2.0: המנוע ב־Go, הממשק נייטיב.")
                }
            }
        }
    }
}

@Composable
fun MoreRow(icon: ImageVector, title: String, sub: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(P.surface, Round).clickable(onClick = onClick).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(44.dp).background(P.brandSoft, androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) { Icon(icon, null, tint = P.brand) }
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = P.ink)
            Text(sub, fontSize = 13.sp, color = P.ink2, maxLines = 2)
        }
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, null, tint = P.ink2)
    }
}

// ---------------------------------------------------------------- location

private val radii = listOf(2.0, 3.0, 4.0, 5.0, 8.0, 12.0)

@SuppressLint("MissingPermission")
private fun lastLocation(ctx: Context): android.location.Location? {
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
        .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
}

@SuppressLint("MissingPermission")
private fun currentLocation(ctx: Context, done: (android.location.Location?) -> Unit) {
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val provider = if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) LocationManager.NETWORK_PROVIDER else LocationManager.GPS_PROVIDER
    if (android.os.Build.VERSION.SDK_INT >= 30) lm.getCurrentLocation(provider, null, ctx.mainExecutor) { done(it ?: lastLocation(ctx)) }
    else done(lastLocation(ctx))
}

@Composable
fun LocationScreen(nav: NavHostController) {
    val ctx = LocalContext.current
    val st = engineState { Go.status() }
    val scope = rememberCoroutineScope()
    var addr by remember { mutableStateOf("") }
    var radius by remember { mutableDoubleStateOf(4.0) }
    var msg by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(st?.place) { st?.place?.let { radius = it.radius } }

    fun choose(name: String, lat: Double, lon: Double) {
        scope.launch {
            Go.setPlace(name, lat, lon, radius); Bus.poke()
            nav.navigate("home") { popUpTo(0) }
        }
    }
    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) { busy = true; msg = "מאתר…"; currentLocation(ctx) { l -> busy = false; if (l != null) choose("המיקום שלי", l.latitude, l.longitude) else msg = "לא הצלחנו לאתר. נסו כתובת." } }
        else msg = "בלי הרשאת מיקום אפשר לבחור כתובת."
    }
    Column(Modifier.fillMaxSize()) {
        if (st?.place != null) Header(nav, "איפה אתם קונים?") else Row(Modifier.fillMaxWidth().background(P.surface).padding(14.dp)) { Title("איפה אתם קונים?") }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Hint("בחרו כתובת או את המיקום הנוכחי, ונשווה את הסניפים שבסביבה לפי המחירונים הרשמיים של הרשתות.")
            Button(onClick = {
                val ok = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                if (ok) { busy = true; msg = "מאתר…"; currentLocation(ctx) { l -> busy = false; if (l != null) choose("המיקום שלי", l.latitude, l.longitude) else msg = "לא הצלחנו לאתר. נסו כתובת." } }
                else askLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy) {
                Icon(Icons.Outlined.MyLocation, null); Spacer(Modifier.width(8.dp)); Text("המיקום הנוכחי", fontWeight = FontWeight.Bold)
            }
            OutlinedTextField(addr, { addr = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("כתובת, למשל ״ביאליק 50, רמת גן״") })
            Button(onClick = {
                busy = true; msg = "מחפש…"
                scope.launch {
                    val r = Go.geocode(addr)
                    busy = false
                    if (r.optBoolean("found")) choose(addr.trim().trimEnd('.', ','), r.optDouble("lat"), r.optDouble("lon"))
                    else msg = r.optString("error").ifEmpty { "לא מצאנו את הכתובת. נסו רחוב ועיר." }
                }
            }, Modifier.fillMaxWidth().height(50.dp), enabled = addr.isNotBlank() && !busy) { Text("חיפוש הכתובת", fontWeight = FontWeight.Bold) }
            Text("טווח", fontWeight = FontWeight.Bold, color = P.ink)
            FlowRowCompat { radii.forEach { r -> Chip("${r.toInt()} ק״מ", radius == r) { radius = r } } }
            if (msg.isNotEmpty()) Hint(msg)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FlowRowCompat(content: @Composable () -> Unit) =
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() }

// ---------------------------------------------------------------- stores and club cards

@Composable
fun StoresScreen(nav: NavHostController) {
    val st = engineState { Go.status() }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Header(nav, "סניפים וכרטיסי מועדון")
        if (st == null) { Loading("טוען…") } else {
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val clubChains = st.stores.filter { it.club }.distinctBy { it.key }
            if (clubChains.isNotEmpty()) item {
                Panel {
                    Text("כרטיסי מועדון", fontWeight = FontWeight.Bold, color = P.ink)
                    Hint("מחירי מועדון נספרים רק ברשתות שסימנתם.")
                    FlowRowCompat { clubChains.forEach { s -> Chip(s.chain, s.key in st.clubOwned) { scope.launch { Go.setClub(s.key, s.key !in st.clubOwned); Bus.poke() } } } }
                }
            }
            item { SectionHead("סניפים בהשוואה", "כבו סניף שלא מתאים לכם") }
            items(st.stores, key = { it.id }) { s ->
                Row(Modifier.fillMaxWidth().background(P.surface, Round).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(s.chain, fontWeight = FontWeight.Bold, color = P.ink)
                        Text(s.branch + if (s.km >= 0) " · ${s.km} ק״מ" else "", fontSize = 12.5.sp, color = P.ink2)
                    }
                    Switch(s.on, { scope.launch { Go.toggleStore(s.id); Bus.poke() } })
                }
            }
        }
    }
}
}

// ---------------------------------------------------------------- AI

@Composable
fun AIScreen(nav: NavHostController) {
    val ctx = LocalContext.current
    val v = engineState { Go.ai() }
    val scope = rememberCoroutineScope()
    var cfg by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(Unit) { cfg = Go.aiConfig() }
    var showKey by remember { mutableStateOf(false) }
    var test by remember { mutableStateOf<String?>(null) }
    var testing by remember { mutableStateOf(false) }
    var models by remember { mutableStateOf<List<String>>(emptyList()) }
    val c = cfg
    fun save(f: (JSONObject) -> Unit) {
        val n = JSONObject(c.toString()); f(n); cfg = n
        scope.launch { Go.setAI(n); Bus.poke() }
    }
    Column(Modifier.fillMaxSize()) {
        Header(nav, "בינה מלאכותית")
        if (v == null || c == null) { Loading("טוען…") } else {
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Panel {
                    Hint("מודל שפה מסווג את כל המוצרים (סוג, מותג, קטגוריה, תזונה וכשרות) ובודק מבצעים שהמחירון לא ברור לגביהם. הכל רץ בטלפון, במנוע ה־Go; נשלחים רק שמות מוצרים ונוסחי מבצעים, בלי פרטים עליכם.")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("שימוש בבינה מלאכותית", Modifier.weight(1f), fontWeight = FontWeight.Bold, color = P.ink)
                        Switch(c.optBoolean("on"), { on -> save { it.put("on", on) } })
                    }
                }
            }
            item {
                Panel {
                    Text("ספק", fontWeight = FontWeight.Bold, color = P.ink)
                    FlowRowCompat {
                        v.presets.forEach { p -> Chip(p.label, c.optString("preset") == p.id) { save { it.put("preset", p.id).put("baseUrl", if (p.id == "custom") it.optString("baseUrl") else p.baseUrl).put("model", p.model) } } }
                    }
                    if (c.optString("preset") == "custom") OutlinedTextField(c.optString("baseUrl"), { u -> save { it.put("baseUrl", u.trim()) } }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("כתובת ה־API (…/v1)") })
                    Text("מפתח API", fontWeight = FontWeight.Bold, color = P.ink)
                    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                        OutlinedTextField(c.optString("key"), { k -> save { it.put("key", k.trim()) } }, Modifier.fillMaxWidth(), singleLine = true,
                            visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            trailingIcon = { IconButton(onClick = { showKey = !showKey }) { Icon(if (showKey) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, "הצגה") } })
                    }
                    v.presets.firstOrNull { it.id == c.optString("preset") }?.keyUrl?.takeIf { it.isNotEmpty() }?.let { url ->
                        TextButton(onClick = { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) { Text("קבלת מפתח חינמי", color = P.brand) }
                    }
                    Text("מודל", fontWeight = FontWeight.Bold, color = P.ink)
                    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                        OutlinedTextField(c.optString("model"), { m -> save { it.put("model", m.trim()) } }, Modifier.fillMaxWidth(), singleLine = true)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { scope.launch { val r = Go.models(); models = (0 until (r.optJSONArray("models")?.length() ?: 0)).map { r.getJSONArray("models").getString(it) }.take(30); if (r.has("error")) test = r.optString("error") } }) { Text("רשימת מודלים") }
                        Button(onClick = { testing = true; scope.launch { test = Go.testAI(); testing = false } }, enabled = !testing) { Text(if (testing) "בודק…" else "בדיקת חיבור") }
                    }
                    if (models.isNotEmpty()) FlowRowCompat { models.forEach { m -> Chip(m, c.optString("model") == m) { save { it.put("model", m) } } } }
                    test?.let { Hint(if (it.isEmpty()) "✓ עובד" else it, if (it.isEmpty()) P.good else P.bad) }
                }
            }
            item {
                Panel {
                    Text("סיווג כל המוצרים", fontWeight = FontWeight.Bold, color = P.ink)
                    val pct = if (v.total > 0) v.records * 100 / v.total else 0
                    LinearProgressIndicator(progress = { pct / 100f }, Modifier.fillMaxWidth(), color = P.brand, trackColor = P.surface2)
                    Text("סווגו ${"%,d".format(v.records)} מתוך ${"%,d".format(v.total)} ($pct%) · מודל: ${v.enrichUses}", fontSize = 13.sp, color = P.ink)
                    Text("היום: ${v.usedToday} מתוך ${v.dailyCap} בקשות", fontSize = 12.5.sp, color = P.ink2)
                    v.run?.let { r ->
                        if (r.live) Text((if (r.kind == "enrich") "מסווג: " else "בודק מבצעים: ") + "${r.done}/${r.of}", color = P.brand, fontWeight = FontWeight.Bold)
                        else if (r.err.isNotEmpty()) Hint("נעצר: ${r.err}", P.bad)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("לסווג מוצרים חדשים ברקע", Modifier.weight(1f), color = P.ink)
                        Switch(c.optBoolean("enrichAuto"), { on -> save { it.put("enrichAuto", on) } })
                    }
                    Text("מודל לסיווג", fontWeight = FontWeight.Bold, color = P.ink, fontSize = 13.sp)
                    FlowRowCompat {
                        listOf("" to "ברירת מחדל", "gemini-4-hydrogen" to "Hydrogen: מדויק", "gemini-flash-lite-latest" to "Flash-Lite: מהיר").forEach { (id, label) ->
                            Chip(label, c.optString("enrichModel") == id) { save { it.put("enrichModel", id) } }
                        }
                    }
                    Text("מכסה יומית", fontWeight = FontWeight.Bold, color = P.ink, fontSize = 13.sp)
                    FlowRowCompat { listOf(50, 150, 300, 1000).forEach { n -> Chip("$n", c.optInt("dailyCap") == n) { save { it.put("dailyCap", n) } } } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (v.run?.live == true) OutlinedButton(onClick = { scope.launch { Go.stopAI() } }) { Text("עצירה") }
                        else Button(onClick = { scope.launch { Go.runEnrich(); Bus.poke() } }, enabled = v.on) { Text("לסווג עכשיו") }
                        OutlinedButton(onClick = { scope.launch { Go.runCheck(); Bus.poke() } }, enabled = v.on && v.run?.live != true) { Text("לבדוק מבצעים") }
                    }
                    val ver = v.verdicts
                    if ((ver.values.sum()) > 0) Hint("בדיקת מבצעים: אושרו ${ver["yes"] ?: 0}, הוסתרו ${ver["no"] ?: 0}, לא ברור ${ver["unclear"] ?: 0}")
                    TextButton(onClick = { scope.launch { Go.clearAI(); Bus.poke() } }) { Text("מחיקת כל הסיווג והתשובות", color = P.ink2) }
                }
            }
        }
    }
}
}
