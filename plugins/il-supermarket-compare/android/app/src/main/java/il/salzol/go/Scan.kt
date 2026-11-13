package il.salzol.go

import android.content.Context
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Scans a product barcode with Google's code scanner (Google Play services shows the camera; the
 * app needs no camera permission). Calls onCode with the digits.
 */
fun scanBarcode(ctx: Context, onCode: (String) -> Unit) {
    val opts = GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128)
        .enableAutoZoom().build()
    GmsBarcodeScanning.getClient(ctx, opts).startScan()
        .addOnSuccessListener { b -> b.rawValue?.filter { it.isDigit() }?.takeIf { it.isNotEmpty() }?.let(onCode) }
}
