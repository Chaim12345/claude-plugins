// The branch map on iOS and Android: MapLibre Native with the free OpenFreeMap style (no API key).
// BranchMap.tsx is the web stand-in (a list; the map is only on phones). If the native library isn't in
// the binary (Expo Go), MAP_SUPPORTED is false and the screen shows the list.
import { Ionicons } from "@expo/vector-icons";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { OPENFREEMAP_STYLE, boundsOf, fitView, hasCoords, padBounds, type LatLon, type Pin } from "../lib/mapgeo";
import { useTheme } from "./ui";

type MapLibre = typeof import("@maplibre/maplibre-react-native");
let ML: MapLibre | null = null;
try {
  ML = require("@maplibre/maplibre-react-native") as MapLibre;
} catch {
  ML = null;
}

export const MAP_SUPPORTED = ML !== null;

export type BranchMapProps = {
  pins: Pin[];
  user: LatLon | null;
  selectedId: string | null;
  onSelect(id: string): void;
  /** The native map failed to start: the screen falls back to the list. */
  onFail(): void;
  fitLabel: string;
};

class Boundary extends Component<{ onFail(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

const USER_BLUE = "#2f6fed";

function PinView({ pin, selected }: { pin: Pin; selected: boolean }) {
  const t = useTheme();
  const fill = pin.cheapest ? t.good : t.surface;
  return (
    <View style={{ alignItems: "center", transform: [{ scale: selected ? 1.12 : 1 }] }} collapsable={false}>
      <View style={{ backgroundColor: fill, borderColor: selected ? t.brand : pin.cheapest ? t.good : t.ink2, borderWidth: selected ? 3 : 1.5, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 3 }}>
        <Text style={{ color: pin.cheapest ? "#ffffff" : t.ink, fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] }}>
          {pin.total != null ? `${pin.label} ₪` : pin.label}
        </Text>
      </View>
      <View style={[s.tip, { borderTopColor: selected ? t.brand : pin.cheapest ? t.good : t.ink2 }]} />
    </View>
  );
}

export function BranchMap({ pins, user, selectedId, onSelect, onFail, fitLabel }: BranchMapProps) {
  const t = useTheme();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const camera = useRef<import("@maplibre/maplibre-react-native").CameraRef>(null);
  const placed = useMemo(() => pins.filter(hasCoords), [pins]);
  const points = useMemo<LatLon[]>(() => [...placed.map(p => ({ lat: p.lat, lon: p.lon })), ...(user ? [user] : [])], [placed, user]);
  const bounds = useMemo(() => { const b = boundsOf(points); return b && padBounds(b, 0.12); }, [points]);
  const view = useMemo(() => (bounds && size ? fitView(bounds, size.w, size.h, 40) : null), [bounds, size]);

  // Selecting a pin (here or from the list) brings it to the middle of the map.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const p = placed.find(x => x.id === selectedId);
    if (p) camera.current?.easeTo({ center: [p.lon, p.lat], duration: 400 });
  }, [selectedId, placed]);

  if (!ML) return null;
  const { Map, Camera, Marker } = ML;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(prev => (prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1 ? prev : { w: width, h: height }));
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.surface2 }} onLayout={onLayout}>
      {view ? (
        <Boundary onFail={onFail}>
          <Map style={StyleSheet.absoluteFill} mapStyle={OPENFREEMAP_STYLE} attribution attributionPosition={{ bottom: 6, left: 6 }} logo={false} compass={false} touchRotate={false} touchPitch={false}>
            <Camera ref={camera} initialViewState={{ center: view.center, zoom: view.zoom }} />
            {user ? (
              <Marker id="you" lngLat={[user.lon, user.lat]} anchor="center">
                <View style={s.user} collapsable={false}><View style={s.userCore} /></View>
              </Marker>
            ) : null}
            {placed.map(p => (
              <Marker key={p.id} id={p.id} lngLat={[p.lon, p.lat]} anchor="bottom" onPress={() => onSelect(p.id)}>
                <PinView pin={p} selected={p.id === selectedId} />
              </Marker>
            ))}
          </Map>
        </Boundary>
      ) : null}
      {bounds ? (
        <Pressable accessibilityRole="button" accessibilityLabel={fitLabel} onPress={() => camera.current?.fitBounds(bounds, { padding: { top: 40, bottom: 40, left: 40, right: 40 }, duration: 500 })}
          style={[s.fit, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Ionicons name="scan-outline" size={20} color={t.brand} />
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  tip: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8, borderLeftColor: "transparent", borderRightColor: "transparent", marginTop: -1 },
  user: { width: 26, height: 26, borderRadius: 13, backgroundColor: USER_BLUE + "40", alignItems: "center", justifyContent: "center" },
  userCore: { width: 14, height: 14, borderRadius: 7, backgroundColor: USER_BLUE, borderWidth: 2, borderColor: "#ffffff" },
  fit: { position: "absolute", top: 10, right: 10, width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
