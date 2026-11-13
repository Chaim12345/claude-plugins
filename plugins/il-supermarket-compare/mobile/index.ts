// Entry point. The background task must be defined in the global scope of the bundle, so the headless
// start-up the system uses for background work defines it before the router mounts.
import "./src/lib/background";
import "expo-router/entry";
