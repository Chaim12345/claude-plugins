import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AiProvider } from "../lib/ai";
import { CurationProvider } from "../lib/curation";
import { EnrichProvider } from "../lib/enrichRun";
import { Onboarding } from "../components/Onboarding";
import { useTheme } from "../components/ui";
import { SettingsProvider } from "../lib/settings";
import { DataProvider } from "../lib/store";
import { WatchProvider } from "../lib/watchctx";

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <SettingsProvider>
      <DataProvider>
      <AiProvider>
      <CurationProvider>
      <EnrichProvider>
       <WatchProvider>
        {/* direction: rtl lays the whole app out right-to-left on iOS, Android and web, with no restart. */}
        <View style={{ flex: 1, direction: "rtl", backgroundColor: t.bg }}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="product/[code]" options={{ presentation: "modal" }} />
            <Stack.Screen name="location" options={{ presentation: "modal" }} />
            <Stack.Screen name="list" options={{ presentation: "modal" }} />
            <Stack.Screen name="scan" options={{ presentation: "modal" }} />
            <Stack.Screen name="saved" options={{ presentation: "modal" }} />
            <Stack.Screen name="map" options={{ presentation: "modal" }} />
            <Stack.Screen name="settings" options={{ presentation: "modal" }} />
            <Stack.Screen name="watch" options={{ presentation: "modal" }} />
            <Stack.Screen name="inbox" options={{ presentation: "modal" }} />
            <Stack.Screen name="notifications" options={{ presentation: "modal" }} />
            <Stack.Screen name="insights" options={{ presentation: "modal" }} />
            <Stack.Screen name="changes" options={{ presentation: "modal" }} />
            <Stack.Screen name="shop" options={{ presentation: "modal" }} />
            <Stack.Screen name="debug" options={{ presentation: "modal" }} />
            <Stack.Screen name="catalog" options={{ presentation: "modal" }} />
            <Stack.Screen name="analysis" options={{ presentation: "modal" }} />
          </Stack>
          <Onboarding />
        </View>
       </WatchProvider>
      </EnrichProvider>
      </CurationProvider>
      </AiProvider>
      </DataProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
