// Release builds shrink the app with R8. Reflection-loaded classes must be kept or the app dies at launch:
//  - WorkManager's Room database (used by expo-background-task): "NoSuchMethodException: WorkDatabase_Impl.<init>"
//  - the gomobile-generated Go bindings (JNI looks them up by name)
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const RULES = `
# --- added by plugins/withKeepRules.js ---
-keep class androidx.work.** { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class androidx.room.** { *; }
-keep class go.** { *; }
-keep class il.salzol.core.** { *; }
-keep class expo.modules.salzolnative.** { *; }
`;

module.exports = function withKeepRules(config) {
  return withDangerousMod(config, ["android", async (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (!cur.includes("withKeepRules.js")) fs.writeFileSync(file, cur + RULES);
    return cfg;
  }]);
};
