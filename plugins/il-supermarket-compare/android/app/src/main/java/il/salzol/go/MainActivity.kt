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
        // automation: `am start -n il.salzol.go/.MainActivity --ed lat 32.08 --ed lon 34.81 --es place "..."` picks a place
        intent?.let { i ->
            if (i.hasExtra("lat") && i.hasExtra("lon")) {
                il.salzol.core.droid.Droid.setPlace(i.getStringExtra("place") ?: "בדיקה", i.getDoubleExtra("lat", 0.0), i.getDoubleExtra("lon", 0.0), i.getDoubleExtra("radius", 4.0))
            }
            i.getStringExtra("tab")?.let { startTab = it }
        }
        setContent { SalzolTheme { AppRoot() } }
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("home", "בית", Icons.Outlined.Home),
    Tab("products", "מוצרים", Icons.Outlined.Search),
    Tab("deals", "מבצעים", Icons.Outlined.LocalOffer),
    Tab("cart", "הסל", Icons.Outlined.ShoppingCart),
    Tab("more", "עוד", Icons.Outlined.MoreHoriz),
)

/** A tab to open on launch (automation and notifications): "deals", "cart", ... */
var startTab: String? = null

/** Opens a product sheet from anywhere. */
fun NavHostController.openProduct(code: String) = navigate("product/" + android.net.Uri.encode(code))

@Composable
fun AppRoot() {
    val nav = rememberNavController()
    val tick by Bus.tick.collectAsState()
    var status by remember { mutableStateOf<StatusView?>(null) }
    LaunchedEffect(tick) { status = Go.status() }
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: "home"
    val st = status
    LaunchedEffect(st != null) { startTab?.let { t -> if (st?.place != null) { nav.navigate(t); startTab = null } } }

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
        Box(Modifier.fillMaxSize().background(P.bg).padding(pad)) {
            // no place yet: choose one first
            val start = if (st != null && st.place == null) "location" else "home"
            if (st == null) Loading("טוען…")
            else NavHost(nav, startDestination = start) {
                composable("home") { HomeScreen(nav) }
                composable("products?cat={cat}", arguments = listOf(navArgument("cat") { type = NavType.StringType; defaultValue = "" })) { ProductsScreen(nav, it.arguments?.getString("cat") ?: "") }
                composable("products") { ProductsScreen(nav, "") }
                composable("deals") { DealsScreen(nav) }
                composable("cart") { CartScreen(nav) }
                composable("more") { MoreScreen(nav) }
                composable("location") { LocationScreen(nav) }
                composable("stores") { StoresScreen(nav) }
                composable("ai") { AIScreen(nav) }
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
