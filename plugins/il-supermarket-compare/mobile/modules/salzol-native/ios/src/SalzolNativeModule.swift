import ExpoModulesCore
import Salzol

// Bridges the Go core (core/mobile) to JavaScript. gomobile exposes the Go package `mobile` with the
// Objective-C prefix `Mobile`: MobileSyncNear, MobileNearbyStores, MobileResolveImage, MobileCancelSync.
public class SalzolNativeModule: Module {
  private var dataDir: String {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let dir = base.appendingPathComponent("salzol", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.path
  }

  public func definition() -> ModuleDefinition {
    Name("SalzolNative")
    Events("onSyncEvent")

    AsyncFunction("syncNear") { (place: String, lat: Double, lon: Double, radiusKm: Double) -> String in
      let listener = SyncListener { [weak self] json in
        self?.sendEvent("onSyncEvent", ["json": json])
      }
      var error: NSError?
      let path = MobileSyncNear(self.dataDir, place, lat, lon, radiusKm, listener, &error)
      if let error = error {
        throw Exception(name: "ERR_SYNC", description: error.localizedDescription)
      }
      return try String(contentsOfFile: path, encoding: .utf8)
    }

    AsyncFunction("nearbyStores") { (lat: Double, lon: Double, radiusKm: Double, max: Int) -> String in
      var error: NSError?
      let json = MobileNearbyStores(lat, lon, radiusKm, max, &error)
      if let error = error {
        throw Exception(name: "ERR_NEARBY", description: error.localizedDescription)
      }
      return json
    }

    AsyncFunction("lastCatalog") { () -> String? in
      let path = (self.dataDir as NSString).appendingPathComponent("catalog.json")
      return try? String(contentsOfFile: path, encoding: .utf8)
    }

    AsyncFunction("resolveImage") { (code: String) -> String in
      return MobileResolveImage(self.dataDir, code)
    }

    Function("cancelSync") {
      MobileCancelSync()
    }
  }
}

private class SyncListener: NSObject, MobileListenerProtocol {
  let onEvent: (String) -> Void
  init(_ onEvent: @escaping (String) -> Void) { self.onEvent = onEvent }
  func onEvent(_ eventJSON: String?) { onEvent(eventJSON ?? "{}") }
}
