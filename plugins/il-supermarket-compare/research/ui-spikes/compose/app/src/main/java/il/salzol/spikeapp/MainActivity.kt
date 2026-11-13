package il.salzol.spikeapp

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import il.salzol.spike.spike.Spike
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG = "SPIKE"
private val Brand = Color(0xFF1E6B4E)

/** The UI test: Go owns the 37,153 products and the search; Compose only draws the visible rows. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val t0 = System.nanoTime()
        val goMs = Spike.load()
        Log.i(TAG, "load go_ms=$goMs total_ms=${(System.nanoTime() - t0) / 1_000_000}")
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                MaterialTheme(colorScheme = lightColorScheme(primary = Brand)) { Screen() }
            }
        }
    }
}

@Composable
fun Screen() {
    var query by remember { mutableStateOf("") }
    var count by remember { mutableIntStateOf(Spike.search("").toInt()) }
    var micros by remember { mutableLongStateOf(0L) }
    var version by remember { mutableIntStateOf(0) } // new results -> new row keys
    val list = rememberLazyListState()

    // the search runs in Go, off the UI thread
    LaunchedEffect(query) {
        val n = withContext(Dispatchers.Default) { Spike.search(query).toInt() }
        count = n; micros = Spike.searchMicros(); version++
        list.scrollToItem(0)
        Log.i(TAG, "search q=\"$query\" n=$n go_us=$micros")
    }

    // self-test: the same steps on every run, timed, for the CI emulator and its screenshots
    LaunchedEffect(Unit) {
        delay(2500)
        for (q in listOf("גבינה", "גבינה צהובה", "חלב 3%", "במבה", "")) { query = q; delay(1800) }
        query = ""
        delay(800)
        var frames = 0; var slow = 0; var worst = 0L
        val start = System.nanoTime()
        coroutineScope {
            // frame durations while the list scrolls through about 1,500 products
            val watcher = launch {
                var last = 0L
                while (true) withFrameNanos { t ->
                    if (last != 0L) { val dt = t - last; frames++; if (dt > 20_000_000) slow++; if (dt > worst) worst = dt }
                    last = t
                }
            }
            repeat(30) { list.animateScrollBy(2400f) }
            watcher.cancel()
        }
        Log.i(TAG, "scroll frames=$frames slow_over_20ms=$slow worst_ms=${worst / 1_000_000} secs=${(System.nanoTime() - start) / 1e9} at_item=${list.firstVisibleItemIndex}")
        Log.i(TAG, "selftest done")
    }

    Column(Modifier.fillMaxSize().background(Color(0xFFF4F1EA)).systemBarsPadding().imePadding()) {
        Column(Modifier.background(Color.White).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("סל זול", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = Brand)
            Text("חלב תנובה 3% 1 ליטר · Tnuva · 6.90 ₪ (מחיר מבצע: 2 ב־12.00 ₪)", fontSize = 15.sp)
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                placeholder = { Text("חיפוש מוצר, למשל ״גבינה צהובה״") }, modifier = Modifier.fillMaxWidth(),
            )
            Text("${"%,d".format(count)} מוצרים · החיפוש ב־Go לקח ${micros} מיקרו־שניות", fontSize = 13.sp, color = Color(0xFF6B6B6B))
        }
        LazyColumn(state = list, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(count, key = { i -> "$version:$i" }) { i -> ProductRow(i) }
        }
    }
}

@Composable
fun ProductRow(i: Int) {
    // each visible row asks Go for its data; rows off screen cost nothing
    val name = remember(i) { Spike.name(i.toLong()) }
    val price = remember(i) { Spike.price(i.toLong()) }
    val stores = remember(i) { Spike.stores(i.toLong()) }
    Row(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(52.dp).background(Color(0xFFE8E2D4), RoundedCornerShape(10.dp)))
        Column(Modifier.weight(1f)) {
            Text(name, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("$stores סניפים", fontSize = 12.5.sp, color = Color(0xFF6B6B6B))
        }
        Text(price, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = Brand)
    }
}
