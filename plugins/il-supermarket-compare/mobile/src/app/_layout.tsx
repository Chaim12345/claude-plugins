import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useTheme } from "../components/ui";
import { DataProvider } from "../lib/store";

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <DataProvider>
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
          </Stack>
        </View>
      </DataProvider>
    </SafeAreaProvider>
  );
}
