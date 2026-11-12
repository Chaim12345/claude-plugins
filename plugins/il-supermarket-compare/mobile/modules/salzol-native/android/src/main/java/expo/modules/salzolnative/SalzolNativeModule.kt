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
      return@AsyncFunction Mobile.nearbyStores(dataDir.absolutePath, lat, lon, radiusKm, max.toLong())
    }

    // Adds the stores of chains whose portals only answer from Israel (Victory, Carrefour, Hazi
    // Hinam, ...) to the on-device directory. Returns the summary JSON; a no-op when nothing is due.
    // Progress goes out on the same onSyncEvent channel ("discover", "stores", "geocode", "skip").
    AsyncFunction("discoverStores") {
      val listener = object : Listener {
        override fun onEvent(eventJSON: String) {
          this@SalzolNativeModule.sendEvent("onSyncEvent", mapOf("json" to eventJSON))
        }
      }
      try {
        return@AsyncFunction Mobile.discoverStores(dataDir.absolutePath, listener)
      } catch (e: Exception) {
        throw CodedException("ERR_DISCOVER", e.message ?: "discovery failed", e)
      }
    }

    // The catalog from the last successful sync, or null.
    AsyncFunction("lastCatalog") {
      val f = File(dataDir, "catalog.json")
      return@AsyncFunction if (f.exists()) f.readText() else null
    }

    AsyncFunction("resolveImage") { code: String ->
      return@AsyncFunction Mobile.resolveImage(dataDir.absolutePath, code)
    }

    // Fallback geocoder: OpenStreetMap services through the Go core, with its city check.
    // Returns {"found":bool,"lat":..,"lon":..}.
    AsyncFunction("geocode") { query: String ->
      return@AsyncFunction Mobile.geocode(dataDir.absolutePath, query)
    }

    // A city's centre estimated from the store directory, embedded plus discovered (no network).
    AsyncFunction("cityCentre") { city: String ->
      return@AsyncFunction Mobile.cityCentre(dataDir.absolutePath, city)
    }

    Function("cancelSync") {
      Mobile.cancelSync()
    }
  }
}
