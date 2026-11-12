import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { DEFAULT_PER_KM } from "./trip";

const KEY = "salzol:perKm";

/** Cost of driving per extra km, in shekels, kept on this device. Falls back to the default if storage is unavailable. */
export function useTripPerKm(): [number, (v: number) => void] {
  const [v, setV] = useState(DEFAULT_PER_KM);
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(s => {
      const n = s == null ? NaN : parseFloat(s);
      if (Number.isFinite(n) && n >= 0 && n <= 20) setV(n);
    }).catch(() => {});
  }, []);
  return [v, (n: number) => {
    const c = Math.max(0, Math.min(20, Math.round(n * 10) / 10));
    setV(c);
    AsyncStorage.setItem(KEY, String(c)).catch(() => {});
  }];
}
