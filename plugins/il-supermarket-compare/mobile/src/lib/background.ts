// The daily background refresh: sync prices for the saved place, diff against the stored snapshot, notify.
//
// Built on expo-background-task (Android WorkManager, iOS BGTaskScheduler). Honest limits:
//  - The system decides when it runs. The interval is a minimum (we ask for 12 h), never a promise.
//  - Android: runs only when battery and network conditions are met; Doze, App Standby and vendor
//    battery savers (Xiaomi, Huawei, Samsung "sleeping apps") can delay or block it; "Force stop" cancels it
//    until the app is opened again. iOS: runs in system-chosen windows, usually overnight on a charger
//    with Wi-Fi, may never run for an app that is rarely opened or in Low Power Mode; a swipe-away in
//    the app switcher stops it.
//  - On Android the task starts the app's own JS runtime headlessly (the whole bundle loads, so the native Go
//    module is registered like in the foreground). It is capped at 10 minutes, so the sync is cancelled
//    after 8. A cold sync takes about 15-60 s on a phone; when nothing is new it takes a few seconds.
//  - On web, in Expo Go without the native module, and when nothing is followed, nothing runs.
import { Platform } from "react-native";
import Native from "../../modules/salzol-native";
import { dlog } from "./debuglog";
import { engine } from "./engine";
import { permission, present } from "./notify";
import { loadPrefs, loadWatch, saveWatch, withLock } from "./watchstore";
import { runCheck, watching } from "./watchflow";

export const TASK = "salzol-daily-refresh";
const INTERVAL_MIN = 12 * 60;
const SYNC_TIMEOUT_MS = 8 * 60_000;

export type JobResult = "done" | "skipped" | "failed";

/** One background run. Exported for tests and for the manual "check now" in settings. */
export async function runBackgroundJob(now = Date.now()): Promise<JobResult> {
  const r = await backgroundJob(now);
  dlog("background", r);
  return r;
}

async function backgroundJob(now: number): Promise<JobResult> {
  if (!watching(await loadWatch())) return "skipped"; // nothing followed: don't spend battery or data
  const { place, off, club } = await loadPrefs();
  if (!place) return "skipped";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let catalog;
  try {
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => { try { Native?.cancelSync(); } catch { /* ignore */ } rej(new Error("timeout")); }, SYNC_TIMEOUT_MS);
    });
    catalog = await Promise.race([engine.sync(place, () => {}), timeout]);
  } catch (e) {
    dlog("background", "sync failed", String((e as Error)?.message ?? e));
    return "failed"; // offline, portal down or cancelled: the system will try again later
  } finally {
    if (timer) clearTimeout(timer);
  }
  const ran = await withLock(async () => {
    const cur = await loadWatch(); // re-read: the app may have changed the watchlist meanwhile
    const allowed = cur.settings.on && (await permission()) === "granted";
    const res = runCheck({ ...cur, settings: { ...cur.settings, on: allowed } }, { catalog, off, club, now });
    await saveWatch({ ...res.state, settings: cur.settings });
    if (allowed) await present(res.send);
    return true;
  });
  return ran ? "done" : "skipped";
}

type TaskManagerModule = typeof import("expo-task-manager");
type BackgroundTaskModule = typeof import("expo-background-task");

// Defined at import time, in the global scope, as the task manager requires: the entry file imports this module.
if (Platform.OS !== "web") {
  try {
    const TM = require("expo-task-manager") as TaskManagerModule;
    const BT = require("expo-background-task") as BackgroundTaskModule;
    TM.defineTask(TASK, async () => {
      let expiry: { remove(): void } | undefined;
      try {
        expiry = BT.addExpirationListener?.(() => { try { Native?.cancelSync(); } catch { /* ignore */ } });
      } catch { /* Android: no expiration listener */ }
      try {
        return (await runBackgroundJob()) === "failed" ? BT.BackgroundTaskResult.Failed : BT.BackgroundTaskResult.Success;
      } catch {
        return BT.BackgroundTaskResult.Failed;
      } finally {
        expiry?.remove();
      }
    });
  } catch { /* the native modules are missing (old build): no background refresh */ }
}

export const backgroundSupported = Platform.OS !== "web";

/** Registers (or cancels) the daily task. Returns whether the system will run it. */
export async function setBackgroundRefresh(on: boolean): Promise<boolean> {
  if (!backgroundSupported) return false;
  try {
    const TM = require("expo-task-manager") as TaskManagerModule;
    const BT = require("expo-background-task") as BackgroundTaskModule;
    const registered = await TM.isTaskRegisteredAsync(TASK);
    if (!on) {
      if (registered) await BT.unregisterTaskAsync(TASK);
      return false;
    }
    if ((await BT.getStatusAsync()) === BT.BackgroundTaskStatus.Restricted) return false;
    if (!registered) await BT.registerTaskAsync(TASK, { minimumInterval: INTERVAL_MIN });
    return true;
  } catch {
    return false;
  }
}
