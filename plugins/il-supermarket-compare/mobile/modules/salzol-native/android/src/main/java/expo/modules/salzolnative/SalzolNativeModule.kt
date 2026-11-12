package expo.modules.salzolnative

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import il.salzol.core.mobile.Listener
import il.salzol.core.mobile.Mobile
import java.io.File

// Bridges the Go core (core/mobile) to JavaScript. Every call that touches the network or parses
// files is an AsyncFunction, so it runs off the JS thread.
class SalzolNativeModule : Module() {
  private val dataDir: File
    get() {
      val ctx = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context unavailable", null)
      return File(ctx.filesDir, "salzol").apply { mkdirs() }
    }

  override fun definition() = ModuleDefinition {
    Name("SalzolNative")
    Events("onSyncEvent")

    // Downloads what's new for the stores around a point and returns the catalog JSON.
    AsyncFunction("syncNear") { place: String, lat: Double, lon: Double, radiusKm: Double ->
      val listener = object : Listener {
        override fun onEvent(eventJSON: String) {
          this@SalzolNativeModule.sendEvent("onSyncEvent", mapOf("json" to eventJSON))
        }
      }
      try {
        val path = Mobile.syncNear(dataDir.absolutePath, place, lat, lon, radiusKm, listener)
        return@AsyncFunction File(path).readText()
      } catch (e: Exception) {
        throw CodedException("ERR_SYNC", e.message ?: "sync failed", e)
      }
    }

    AsyncFunction("nearbyStores") { lat: Double, lon: Double, radiusKm: Double, max: Int ->
      return@AsyncFunction Mobile.nearbyStores(lat, lon, radiusKm, max.toLong())
    }

    // The catalog from the last successful sync, or null.
    AsyncFunction("lastCatalog") {
      val f = File(dataDir, "catalog.json")
      return@AsyncFunction if (f.exists()) f.readText() else null
    }

    AsyncFunction("resolveImage") { code: String ->
      return@AsyncFunction Mobile.resolveImage(dataDir.absolutePath, code)
    }

    Function("cancelSync") {
      Mobile.cancelSync()
    }
  }
}
