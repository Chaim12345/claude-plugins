import { NativeModule, requireOptionalNativeModule } from "expo";

export type SyncEventPayload = { json: string };

type Events = { onSyncEvent(e: SyncEventPayload): void };

declare class SalzolNativeModule extends NativeModule<Events> {
  syncNear(place: string, lat: number, lon: number, radiusKm: number): Promise<string>;
  nearbyStores(lat: number, lon: number, radiusKm: number, max: number): Promise<string>;
  lastCatalog(): Promise<string | null>;
  resolveImage(code: string): Promise<string>;
  cancelSync(): void;
  /** OpenStreetMap geocoding through the Go core: {"found","lat","lon"} as JSON. */
  geocode(query: string): Promise<string>;
  /** A city's centre from the built-in store directory: {"found","lat","lon"} as JSON. */
  cityCentre(city: string): Promise<string>;
}

// null on web, in Expo Go, or in a build made before the Go library was added.
export default requireOptionalNativeModule<SalzolNativeModule>("SalzolNative");
