# gomobile's bindings are called from native code by name
-keep class go.** { *; }
-keep class il.salzol.core.** { *; }
# WorkManager creates its Room database by reflection: without these the app dies at launch with
# "NoSuchMethodException: WorkDatabase_Impl.<init>" (the same rule the React Native app needed)
-keep class androidx.work.** { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keep class androidx.room.** { *; }
