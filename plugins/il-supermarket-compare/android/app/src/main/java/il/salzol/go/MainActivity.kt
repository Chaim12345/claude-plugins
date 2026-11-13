package il.salzol.go

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import il.salzol.go.ui.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // only a fresh start reads the extras: a rotation recreates the activity with the same intent
        if (savedInstanceState == null) handle(intent)
        setContent { SalzolTheme { AppRoot() } }
    }

    // a notification tapped while the app is already open
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(i: android.content.Intent?) {
        i ?: return
        // automation: `am start -n il.salzol.go/.MainActivity --ed lat 32.08 --ed lon 34.81 --es place "..."` picks a
        // place. The activity is exported (it is the launcher), so the values are checked: Israel only.
        if (i.hasExtra("lat") && i.hasExtra("lon")) {
            val lat = i.getDoubleExtra("lat", 0.0); val lon = i.getDoubleExtra("lon", 0.0)
            if (lat in 29.0..33.6 && lon in 34.0..36.0) {
                il.salzol.core.droid.Droid.setPlace((i.getStringExtra("place") ?: "בדיקה").take(60), lat, lon, i.getDoubleExtra("radius", 4.0).coerceIn(1.0, 25.0))
            }
        }
        i.getStringExtra("tab")?.takeIf { t -> tabs.any { it.route == t } || t in extraRoutes }?.let { startTab = it }
        i.getStringExtra("product")?.takeIf { it.length in 1..40 }?.let { startTab = "product/" + android.net.Uri.encode(it) } // from a notification
    }
}

/** Screens that automation may open by name (anything else in the "tab" extra is ignored). */
private val extraRoutes = setOf("location", "stores", "ai", "catalog", "changes", "watch", "lists", "paste", "analysis", "log", "shop")

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("home", "בית", Icons.Outlined.Home),
    Tab("products", "מוצרים", Icons.Outlined.Search),
    Tab("deals", "מבצעים", Icons.Outlined.LocalOffer),
    Tab("cart", "הסל", Icons.Outlined.ShoppingCart),
    Tab("more", "עוד", Icons.Outlined.MoreHoriz),
)

/** A screen to open (automation and notifications): "deals", "cart", ... State, so a new intent opens it too. */
var startTab by mutableStateOf<String?>(null)

/** Opens a product sheet from anywhere. */
fun NavHostController.openProduct(code: String) = navigate("product/" + android.net.Uri.encode(code))

@Composable
fun AppRoot() {
    val nav = rememberNavController()
    val tick by Bus.tick.collectAsState()
    var status by remember { mutableStateOf<StatusView?>(null) }
    val appCtx = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(tick) {
        runCatching { status = Go.status() }
        // every event, not only "catalog": Go sends "catalog" and then "sync" right after, so the
        // type seen here is usually the second one
        Go.io { takeAndPostNotices(appCtx) }
    }
    val entry by nav.currentBackStackEntryAsState()
    // "products?cat={cat}" is the products tab with a category: the same tab for the bar
    val route = (entry?.destination?.route ?: "home").substringBefore('?')
    val st = status
    // the first screen is decided once, when the status first arrives (a NavHost must not change it later)
    var start by remember { mutableStateOf<String?>(null) }
    if (start == null && st != null) start = if (st.place == null) "location" else "home"
    val ctx = androidx.compose.ui.platform.LocalContext.current
    // saved: the report is read from disk once (reading deletes it), so a rotation must not lose it
    var crash by rememberSaveable { mutableStateOf(takeCrashReport(ctx)) }
    // the NavHost exists only once the first screen is known and no crash report is showing
    LaunchedEffect(startTab, st != null, start != null, crash.isEmpty()) {
        val t = startTab
        if (t != null && st?.place != null && start != null && crash.isEmpty()) {
            runCatching { nav.navigate(t) }
            startTab = null
        }
    }

    Scaffold(
        containerColor = P.bg,
        bottomBar = {
            if (tabs.any { it.route == route }) NavigationBar(containerColor = P.surface) {
                tabs.forEach { t ->
                    NavigationBarItem(
                        selected = route == t.route,
                        onClick = { nav.navigate(t.route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true } },
                        icon = {
                            if (t.route == "cart" && (st?.cartCount ?: 0) > 0) BadgedBox(badge = { Badge { Text("${st!!.cartCount}") } }) { Icon(t.icon, null) }
                            else Icon(t.icon, null)
                        },
                        label = { Text(t.label, fontWeight = if (route == t.route) FontWeight.Bold else FontWeight.Normal) },
                        colors = NavigationBarItemDefaults.colors(selectedIconColor = P.brand, selectedTextColor = P.brand, indicatorColor = P.brandSoft),
                    )
                }
            }
        },
    ) { pad ->
        // edge-to-edge: the window no longer resizes for the keyboard, so the content makes room for it
        // (consumeWindowInsets: the bar insets in pad are not added a second time)
        Box(Modifier.fillMaxSize().background(P.bg).padding(pad).consumeWindowInsets(pad).imePadding()) {
            if (crash.isNotEmpty()) CrashScreen(crash) { crash = "" }
            else if (st == null || start == null) Loading("טוען…")
            else NavHost(nav, startDestination = start!!) {
                composable("home") { HomeScreen(nav) }
                composable("products?cat={cat}", arguments = listOf(navArgument("cat") { type = NavType.StringType; defaultValue = "" })) { ProductsScreen(nav, it.arguments?.getString("cat") ?: "") }
                composable("products") { ProductsScreen(nav, "") }
                composable("deals") { DealsScreen(nav) }
                composable("cart") { CartScreen(nav) }
                composable("more") { MoreScreen(nav) }
                composable("location") { LocationScreen(nav) }
                composable("stores") { StoresScreen(nav) }
                composable("ai") { AIScreen(nav) }
                composable("catalog") { CatalogScreen(nav) }
                composable("changes") { ChangesScreen(nav) }
                composable("watch") { WatchScreen(nav) }
                composable("lists") { ListsScreen(nav) }
                composable("paste") { PasteScreen(nav) }
                composable("analysis") { AnalysisScreen(nav) }
                composable("log") { LogScreen(nav) }
                composable("shop?store={store}", arguments = listOf(navArgument("store") { type = NavType.StringType; defaultValue = "" })) { ShopScreen(nav, it.arguments?.getString("store") ?: "") }
                composable("product/{code}", arguments = listOf(navArgument("code") { type = NavType.StringType })) {
                    ProductScreen(nav, it.arguments?.getString("code") ?: "")
                }
            }
        }
    }
}

/** The top of each tab: the place, the price date, and the sync status. */
@Composable
fun PlaceBar(nav: NavHostController, st: StatusView?) {
    Row(Modifier.fillMaxWidth().background(P.surface).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("סל זול", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = P.brand)
            val line = when {
                st == null -> ""
                st.syncing -> st.syncMsg.ifEmpty { "מעדכן מחירים…" }
                st.syncErr.isNotEmpty() -> "העדכון נכשל: ${st.syncErr}"
                st.ready -> "מחירון אחרון: ${st.priceDate} · ${st.stores.count { it.on }} סניפים · ${"%,d".format(st.products)} מוצרים"
                else -> "טוען את הקטלוג…"
            }
            Text(line, fontSize = 12.5.sp, color = if (st?.syncErr?.isNotEmpty() == true) P.bad else P.ink2, maxLines = 1)
        }
        AssistChip(onClick = { nav.navigate("location") }, label = { Text(st?.place?.name ?: "בחירת מיקום", maxLines = 1) },
            leadingIcon = { Icon(Icons.Outlined.Place, null, Modifier.size(18.dp)) })
        val scope = rememberCoroutineScope()
        IconButton(onClick = { scope.launch { Go.sync(); Bus.poke() } }) { Icon(Icons.Outlined.Refresh, "עדכון מחירים", tint = P.ink) }
    }
}

/** Shown once after a crash: what happened, to share with the developer. */
@Composable
fun CrashScreen(report: String, onContinue: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Title("האפליקציה נסגרה בפעם הקודמת")
        Hint("אפשר לשלוח את הפרטים האלה כדי שנתקן. אין בהם מידע אישי.")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                val i = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, report)
                ctx.startActivity(android.content.Intent.createChooser(i, "שליחת הדוח"))
            }) { Text("שיתוף הדוח") }
            OutlinedButton(onClick = onContinue) { Text("המשך") }
        }
        androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().background(P.surface, Round).padding(8.dp)) {
            item {
                androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Ltr) {
                    Text(report, fontSize = 11.sp, color = P.ink, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                }
            }
        }
    }
}
