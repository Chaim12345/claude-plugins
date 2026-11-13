// The catalog curation the user ran (curate.ts), kept on the phone and applied by the data store to
// every catalog it shows. A small module-level store (not a React context): the data store applies it,
// and the runner (curation.tsx), which needs the data store's catalog, sits below it in the tree.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { emptyCuration, type Curation, type TaskKind } from "./curate";

const KEY = "salzol:curation";
let state: Curation = emptyCuration();
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadCuration(): Promise<Curation> {
  if (loaded) return state;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) state = { ...emptyCuration(), ...JSON.parse(raw) };
  } catch { /* keep empty */ }
  loaded = true;
  listeners.forEach(l => l());
  return state;
}

export function updateCuration(fn: (c: Curation) => Curation) {
  state = fn(state);
  listeners.forEach(l => l());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {}); }, 500);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useCuration = (): Curation => useSyncExternalStore(subscribe, () => state, () => state);

// ---------- user controls ----------

export const setTaskOn = (k: TaskKind, on: boolean) => updateCuration(c => ({ ...c, on: { ...c.on, [k]: on } }));
export const setAutoLinks = (on: boolean) => updateCuration(c => ({ ...c, autoLinks: on }));
/** Undo one change (or bring it back). */
export const toggleUndo = (k: TaskKind, code: string) => updateCuration(c => {
  const key = `${k}:${code}`, rejected = { ...c.rejected }, approved = { ...c.approved };
  if (rejected[key]) delete rejected[key]; else { rejected[key] = 1; delete approved[key]; }
  return { ...c, rejected, approved };
});
export const approveLink = (code: string, yes: boolean) => updateCuration(c => {
  const key = `links:${code}`, rejected = { ...c.rejected }, approved = { ...c.approved };
  if (yes) { approved[key] = 1; delete rejected[key]; } else { rejected[key] = 1; delete approved[key]; }
  return { ...c, rejected, approved };
});
/** Forget a task's answers: its products are asked again on the next run. */
export const resetTask = (k: TaskKind) => updateCuration(c => {
  const drop = (r: Record<string, 1>) => Object.fromEntries(Object.entries(r).filter(([key]) => !key.startsWith(`${k}:`))) as Record<string, 1>;
  return { ...c, [k]: {}, rejected: drop(c.rejected), approved: drop(c.approved), asked: drop(c.asked) };
});


/** Undo everything and forget every answer. */
export const resetAll = () => updateCuration(() => emptyCuration());
