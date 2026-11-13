# gomobile's bindings are called from native code by name
-keep class go.** { *; }
-keep class il.salzol.core.** { *; }
# WorkManager creates its Room database by reflection: without these the app dies at launch with
# "NoSuchMethodException: WorkDatabase_Impl.<init>" (the same rule the React Native app needed)
-keep class androidx.work.** { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class androidx.room.** { *; }
# ML Kit / Google Play services find their components by class name from the manifest
# (MlKitComponentDiscoveryService meta-data): R8 removes the registrars as unused, and tapping the
# barcode button then dies with an NPE inside GmsBarcodeScanning.getClient
-keep class * implements com.google.firebase.components.ComponentRegistrar { *; }
-keep class com.google.firebase.components.** { *; }
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_code_scanner.** { *; }
-dontwarn com.google.mlkit.**
