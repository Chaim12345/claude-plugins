// Web: no interactive map (MapLibre Native is phone-only). The map screen shows the branch list instead.
// The native version is BranchMap.native.tsx; both export the same names.
import type { LatLon, Pin } from "../lib/mapgeo";

export const MAP_SUPPORTED = false;

export type BranchMapProps = {
  pins: Pin[];
  user: LatLon | null;
  selectedId: string | null;
  onSelect(id: string): void;
  onFail(): void;
  fitLabel: string;
};

export function BranchMap(_: BranchMapProps) {
  return null;
}
