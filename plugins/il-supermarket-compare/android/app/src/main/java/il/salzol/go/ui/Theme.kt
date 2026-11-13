package il.salzol.go.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection

/** The app's colours (the same tokens as the React Native app's ui.tsx). */
data class Palette(
    val bg: Color, val surface: Color, val surface2: Color, val ink: Color, val ink2: Color, val line: Color,
    val brand: Color, val brandInk: Color, val brandSoft: Color, val tag: Color, val tagInk: Color,
    val good: Color, val warn: Color, val bad: Color,
)

val Light = Palette(
    Color(0xFFF4F5EF), Color.White, Color(0xFFE9ECE2), Color(0xFF1B2620), Color(0xFF56625A), Color(0xFFD6DBCF),
    Color(0xFF1D6B47), Color.White, Color(0xFFDCEBE2), Color(0xFFF6CF3A), Color(0xFF1B1B14),
    Color(0xFF1D7A3E), Color(0xFFA65B00), Color(0xFFB3261E),
)
val Dark = Palette(
    Color(0xFF121814), Color(0xFF1A221D), Color(0xFF232D27), Color(0xFFE8EEE9), Color(0xFF9FB0A5), Color(0xFF2F3B34),
    Color(0xFF4CC18A), Color(0xFF0D1A13), Color(0xFF1F3A2C), Color(0xFFF2C83A), Color(0xFF17160E),
    Color(0xFF5FD08F), Color(0xFFF0A54A), Color(0xFFFF8A80),
)

val LocalPalette = staticCompositionLocalOf { Light }
val P: Palette @Composable get() = LocalPalette.current

/** Right-to-left everywhere, the app's colours, Material 3 underneath. */
@Composable
fun SalzolTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val p = if (dark) Dark else Light
    val scheme = if (dark) darkColorScheme(primary = p.brand, onPrimary = p.brandInk, background = p.bg, surface = p.surface, onSurface = p.ink, secondaryContainer = p.brandSoft)
    else lightColorScheme(primary = p.brand, onPrimary = p.brandInk, background = p.bg, surface = p.surface, onSurface = p.ink, secondaryContainer = p.brandSoft)
    CompositionLocalProvider(LocalPalette provides p, LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
