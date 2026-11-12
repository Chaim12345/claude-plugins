// Slot for settings sections added by other features. settings.tsx renders <ExtraSettingsSections /> between
// the built-in sections and the data / about sections. To add one, build it from SettingsSection (see
// SettingsSection.tsx) and list it below, for example the notification settings:
//
//   import { NotificationSettings } from "./NotificationSettings";
//   export function ExtraSettingsSections() {
//     return <><NotificationSettings /></>;
//   }
//
// Text goes through useSettings().t (add the keys to src/i18n/he.ts and en.ts) so it follows the language setting.
export function ExtraSettingsSections() {
  return null;
}
