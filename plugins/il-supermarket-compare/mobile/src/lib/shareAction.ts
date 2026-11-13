// Sending text out of the app: the system share sheet, or the clipboard where there's no share sheet.
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";

export type ShareResult = "shared" | "copied" | "dismissed" | "failed";

export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/** Opens the share sheet. Browsers without the Web Share API reject; the text is copied instead, so the button always does something. */
export async function shareText(message: string, title?: string): Promise<ShareResult> {
  try {
    const r = await Share.share({ message, title });
    return r.action === Share.dismissedAction ? "dismissed" : "shared";
  } catch {
    return (await copyText(message)) ? "copied" : "failed";
  }
}
