import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Header } from "../../components/Header";
import { useTheme } from "../../components/ui";
import { money } from "../../lib/compare";
import { useData } from "../../lib/store";

export default function TabLayout() {
  const t = useTheme();
  const { cart, comparison } = useData();
  const n = Object.keys(cart).length;
  const best = comparison?.rows[0];
  return (
    <Tabs screenOptions={{
      header: () => <Header />,
      sceneStyle: { backgroundColor: t.bg }, // otherwise the screens stay white in dark mode
      tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.ink2,
      tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
      tabBarLabelStyle: { fontWeight: "700" },
    }}>
      <Tabs.Screen name="index" options={{ title: "מוצרים", tabBarIcon: ({ color, size }) => <Ionicons name="basket-outline" color={color as string} size={size} /> }} />
      <Tabs.Screen name="cart" options={{
        title: best && n ? `הסל · ${money(best.total)} ₪` : "הסל",
        tabBarBadge: n || undefined, tabBarBadgeStyle: { backgroundColor: t.tag, color: t.tagInk },
        tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" color={color as string} size={size} />,
      }} />
    </Tabs>
  );
}
