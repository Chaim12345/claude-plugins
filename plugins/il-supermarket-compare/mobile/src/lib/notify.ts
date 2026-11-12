// System notifications (expo-notifications). Native only: on web there are no system notifications and
// everything here is a no-op, so the in-app inbox is the only place alerts show up. The module is loaded
// lazily so the web bundle never evaluates it.
import { Platform } from "react-native";
import type { ToSend } from "./alerts";

export const CHANNEL_ID = "deals";
export const notificationsSupported = Platform.OS !== "web";
export type Permission = "granted" | "denied" | "undetermined" | "unsupported";

type NotificationsModule = typeof import("expo-notifications");
let mod: NotificationsModule | null | undefined;
function N(): NotificationsModule | null {
  if (!notificationsSupported) return null;
  if (mod === undefined) {
    try { mod = require("expo-notifications") as NotificationsModule; } catch { mod = null; }
  }
  return mod;
}

/** The "דילים" channel: default importance (sound, no heads-up pop-up: a deal can wait a minute). Idempotent. */
export async function ensureChannel(): Promise<void> {
  const n = N();
  if (!n || Platform.OS !== "android") return;
  await n.setNotificationChannelAsync(CHANNEL_ID, {
    name: "דילים",
    description: "מבצעים וירידות מחיר במוצרים ובסל שאתם עוקבים אחריהם",
    importance: n.AndroidImportance.DEFAULT,
    lightColor: "#1d6b47",
    showBadge: true,
  }).catch(() => {});
}

/** Shows notifications that arrive while the app is open too, as a banner (the person may be in the app on another screen). */
export function installHandler(): void {
  const n = N();
  if (!n) return;
  n.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function permission(): Promise<Permission> {
  const n = N();
  if (!n) return "unsupported";
  try {
    const p = await n.getPermissionsAsync();
    if (p.granted) return "granted";
    return p.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

/** Asks for the permission (Android 13+ POST_NOTIFICATIONS, iOS alert). The channel must exist first or Android never shows the prompt. */
export async function requestPermission(): Promise<Permission> {
  const n = N();
  if (!n) return "unsupported";
  try {
    await ensureChannel();
    const p = await n.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    return p.granted ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

/** Posts local notifications now. Returns how many were handed to the system. */
export async function present(items: ToSend[]): Promise<number> {
  const n = N();
  if (!n || !items.length) return 0;
  await ensureChannel();
  let sent = 0;
  for (const it of items) {
    try {
      await n.scheduleNotificationAsync({
        identifier: it.id,
        content: { title: it.title, body: it.body, data: it.code ? { code: it.code } : { inbox: true }, color: "#1d6b47" },
        trigger: { channelId: CHANNEL_ID },
      });
      sent++;
    } catch { /* one failure must not stop the rest */ }
  }
  return sent;
}

/** Calls `open` with the product code (or null for the inbox) when a notification is tapped, including the one that launched the app. */
export function onTap(open: (code: string | null) => void): () => void {
  const n = N();
  if (!n) return () => {};
  const handle = (r: { notification: { request: { content: { data?: unknown } } } } | null) => {
    if (!r) return;
    const data = r.notification.request.content.data as { code?: string } | undefined;
    open(data?.code ?? null);
  };
  n.getLastNotificationResponseAsync().then(r => { if (r) { handle(r); n.clearLastNotificationResponseAsync().catch(() => {}); } }).catch(() => {});
  const sub = n.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
