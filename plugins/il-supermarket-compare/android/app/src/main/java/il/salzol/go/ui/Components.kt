package il.salzol.go.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.ShoppingBasket
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import il.salzol.go.DealView
import il.salzol.go.ItemView

val Round = RoundedCornerShape(14.dp)

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) =
    Column(modifier.fillMaxWidth().background(P.surface, Round).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)

@Composable
fun Title(text: String, modifier: Modifier = Modifier) = Text(text, modifier, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = P.ink)

@Composable
fun SectionHead(title: String, sub: String = "", action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, color = P.ink)
            if (sub.isNotEmpty()) Text(sub, fontSize = 12.5.sp, color = P.ink2)
        }
        if (action != null) TextButton(onClick = onAction) { Text(action, color = P.brand, fontWeight = FontWeight.Bold) }
    }
}

@Composable
fun Hint(text: String, color: Color = P.ink2) = Text(text, fontSize = 12.5.sp, color = color, lineHeight = 18.sp)

/** The product photo, or a basket on the category colour while it loads or when there is none. */
@Composable
fun ProductImage(url: String, size: Dp, modifier: Modifier = Modifier) {
    val box = modifier.size(size).clip(RoundedCornerShape(10.dp)).background(P.surface2)
    if (url.isEmpty()) {
        Box(box, contentAlignment = Alignment.Center) { Icon(Icons.Outlined.ShoppingBasket, null, tint = P.ink2, modifier = Modifier.size(size / 2.4f)) }
        return
    }
    SubcomposeAsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Fit, modifier = box.background(Color.White), loading = {
        Box(Modifier.fillMaxSize().background(P.surface2))
    }, error = {
        Box(Modifier.fillMaxSize().background(P.surface2), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.ShoppingBasket, null, tint = P.ink2, modifier = Modifier.size(size / 2.4f)) }
    })
}

/** The yellow price tag: "12.90 ₪". */
@Composable
fun PriceTag(price: String, big: Boolean = false) {
    Box(Modifier.background(P.tag, RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text("$price ₪", color = P.tagInk, fontWeight = FontWeight.ExtraBold, fontSize = if (big) 22.sp else 16.sp)
    }
}

@Composable
fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(CircleShape).border(1.dp, if (on) P.brand else P.line, CircleShape).background(if (on) P.brandSoft else P.surface)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    ) { Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = P.ink) }
}

/** − qty + ; minus at 1 (or 0.5 kg) removes. */
@Composable
fun Stepper(qty: Double, weighted: Boolean, onChange: (Double) -> Unit) {
    val step = if (weighted) 0.5 else 1.0
    Row(Modifier.background(P.brandSoft, CircleShape).padding(2.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onChange(qty - step) }, Modifier.size(36.dp).semantics { contentDescription = "פחות" }) { Icon(Icons.Outlined.Remove, null, tint = P.brand) }
        Text(if (weighted) "${fmtQty(qty)} ק״ג" else fmtQty(qty), fontWeight = FontWeight.Bold, color = P.ink, modifier = Modifier.widthIn(min = 28.dp))
        IconButton(onClick = { onChange(qty + step) }, Modifier.size(36.dp).semantics { contentDescription = "עוד אחד" }) { Icon(Icons.Outlined.Add, null, tint = P.brand) }
    }
}

fun fmtQty(q: Double) = if (q == Math.floor(q)) q.toLong().toString() else q.toString()

@Composable
fun AddButton(onClick: () -> Unit) {
    FilledIconButton(onClick = onClick, Modifier.size(40.dp).semantics { contentDescription = "הוספה לסל" }, colors = IconButtonDefaults.filledIconButtonColors(containerColor = P.brand)) {
        Icon(Icons.Outlined.Add, null, tint = P.brandInk)
    }
}

/** A product in a list: photo, name, where it's cheapest, unit price, deal; price and add on the left. */
@Composable
fun ItemRow(it: ItemView, onOpen: () -> Unit, onQty: (Double) -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(P.surface, Round).clickable(onClick = onOpen).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ProductImage(it.img, 60.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(it.name, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, color = P.ink)
            val where = if (it.where.isEmpty()) "" else "${it.where} · ${it.branches} סניפים"
            if (where.isNotEmpty()) Text(where, fontSize = 12.5.sp, color = P.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (it.unit.isNotEmpty()) Text(it.unit, fontSize = 12.sp, color = P.ink2)
            if (it.deal.isNotEmpty()) Badge(if (it.dealClub) "מועדון: ${it.deal}" else "מבצע: ${it.deal}", P.bad)
            if (it.stale) Badge("אולי לא על המדף", P.warn)
            if (it.tags.isNotEmpty()) Text(it.tags, fontSize = 11.5.sp, color = P.good)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (it.price.isNotEmpty()) PriceTag(it.price) else Text("אין מחיר במחירון", fontSize = 12.sp, color = P.ink2, fontWeight = FontWeight.Bold)
            if (it.qty > 0) Stepper(it.qty, it.weighted, onQty) else AddButton { onQty(if (it.weighted) 0.5 else 1.0) }
        }
    }
}

@Composable
fun Badge(text: String, color: Color) {
    Text(text, color = color, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.background(color.copy(alpha = 0.10f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp))
}

/** A deal: how much you save, what you pay, where and until when, whether to check at the till. */
@Composable
fun DealCard(d: DealView, width: Dp?, onOpen: () -> Unit, onAdd: () -> Unit) {
    val m = if (width != null) Modifier.width(width) else Modifier.fillMaxWidth()
    Column(
        m.background(P.surface, Round).then(if (d.mine) Modifier.border(1.5.dp, P.brand, Round) else Modifier).clickable(onClick = onOpen).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box {
            ProductImage(d.img, 120.dp, Modifier.fillMaxWidth())
            if (d.pct > 0) Text("−${d.pct}%", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp,
                modifier = Modifier.padding(6.dp).background(if (d.check.isNotEmpty()) P.ink2 else P.bad, RoundedCornerShape(8.dp)).padding(horizontal = 7.dp, vertical = 2.dp))
        }
        Text(d.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, minLines = 2, overflow = TextOverflow.Ellipsis, color = P.ink)
        Text(d.headline, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = if (d.real) P.good else P.warn, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PriceTag(d.price)
            Text("${d.was} ₪", fontSize = 12.5.sp, color = P.ink2, textDecoration = TextDecoration.LineThrough)
        }
        Text(d.terms, fontSize = 12.sp, color = P.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (d.check.isNotEmpty()) Row(Modifier.background(P.warn.copy(alpha = 0.10f), RoundedCornerShape(8.dp)).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(Icons.Outlined.ErrorOutline, null, tint = P.warn, modifier = Modifier.size(14.dp))
            Text(d.check, fontSize = 11.5.sp, color = P.warn, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 15.sp)
        } else if (d.aiYes) Text("המבצע אומת ב־AI", fontSize = 11.5.sp, color = P.good)
        Text(d.where, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(if (d.end.isEmpty()) "ללא תאריך סיום" else d.end + if (d.soon) " · נגמר בקרוב" else "", fontSize = 12.sp, color = if (d.soon) P.bad else P.ink2)
        Button(onClick = onAdd, Modifier.fillMaxWidth().height(40.dp), colors = ButtonDefaults.buttonColors(containerColor = if (d.inCart > 0) P.brandSoft else P.brand)) {
            Text(if (d.inCart > 0) "בסל (${fmtQty(d.inCart)})" else if (d.qty > 1) "הוספת ${d.qty} לסל" else "הוספה לסל", color = if (d.inCart > 0) P.brand else P.brandInk, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun Loading(text: String) {
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        CircularProgressIndicator(color = P.brand)
        Spacer(Modifier.height(12.dp))
        Text(text, color = P.ink2)
    }
}
