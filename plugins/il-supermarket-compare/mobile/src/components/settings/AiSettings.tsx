import { useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, TextInput, View } from "react-native";
import { useAi } from "../../lib/ai";
import { stats } from "../../lib/aicheck";
import { PRESETS, validBaseUrl, type PresetId } from "../../lib/llm";
import { useSettings } from "../../lib/settings";
import { Button, T, useTheme } from "../ui";
import { Chip, Hint, SettingsSection } from "./SettingsSection";

/**
 * Settings → AI: a free Gemini key, or any OpenAI-compatible provider (OpenRouter, Groq, a custom URL).
 * Used to settle "check at the till" deals. Everything is optional; without it the app works as before.
 */
export function AiSettings() {
  const t = useTheme();
  const { t: tr, tx } = useSettings();
  const { cfg, setCfg, loaded, verdicts, status, test, models, clear, cancel } = useAi();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [list, setList] = useState<string[] | null>(null);
  const [listErr, setListErr] = useState("");
  const preset = PRESETS[cfg.preset];
  const s = stats(verdicts, Date.now());

  if (!loaded) return null;

  const pick = (id: PresetId) => {
    const p = PRESETS[id];
    setCfg({ ...cfg, preset: id, baseUrl: id === "custom" ? (cfg.preset === "custom" ? cfg.baseUrl : "") : p.baseUrl, model: p.model });
    setList(null); setResult(null);
  };
  const runTest = async () => { setTesting(true); setResult(await test()); setTesting(false); };
  const loadModels = async () => {
    setListErr("");
    try { const m = await models(); setList(m.slice(0, 40)); if (!m.length) setListErr(tr("ai.noModels")); }
    catch (e) { setListErr((e as Error).message); }
  };
  const input = [{ height: 42, borderRadius: 10, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface2, paddingHorizontal: 10, color: t.ink, fontSize: 14, textAlign: "left" as const, writingDirection: "ltr" as const }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)];
  const label = (s: string) => <T style={[tx, { fontWeight: "700", fontSize: 13.5 }]}>{s}</T>;

  return (
    <SettingsSection title={tr("ai.title")} hint={tr("ai.hint")}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <T style={[tx, { fontWeight: "700", flexShrink: 1 }]}>{tr("ai.on")}</T>
        <Switch value={cfg.on} onValueChange={on => setCfg({ ...cfg, on })} accessibilityLabel={tr("ai.on")} />
      </View>

      {label(tr("ai.provider"))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(PRESETS) as PresetId[]).map(id => <Chip key={id} role="radio" on={cfg.preset === id} label={id === "gemini" ? tr("ai.gemini") : id === "custom" ? tr("ai.custom") : PRESETS[id].label} onPress={() => pick(id)} />)}
      </View>

      {cfg.preset === "custom" ? (
        <View style={{ gap: 6 }}>
          {label(tr("ai.baseUrl"))}
          <TextInput value={cfg.baseUrl} onChangeText={v => setCfg({ ...cfg, baseUrl: v.trim() })} placeholder="https://example.com/v1" autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={tr("ai.baseUrl")} style={input} placeholderTextColor={t.ink2} />
          {cfg.baseUrl && !validBaseUrl(cfg.baseUrl) ? <Hint bad>{tr("ai.badUrl")}</Hint> : <Hint>{tr("ai.baseUrlHint")}</Hint>}
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        {label(tr("ai.key"))}
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <TextInput value={cfg.key} onChangeText={v => setCfg({ ...cfg, key: v.trim() })} secureTextEntry={!showKey} placeholder={cfg.preset === "gemini" ? "AIza…" : "sk-…"} autoCapitalize="none" autoCorrect={false}
            accessibilityLabel={tr("ai.key")} style={[input, { flex: 1 }]} placeholderTextColor={t.ink2} />
          <Button kind="ghost" title={showKey ? tr("ai.hide") : tr("ai.show")} onPress={() => setShowKey(v => !v)} style={{ height: 42, paddingHorizontal: 10 }} />
        </View>
        {preset.keyUrl ? (
          <Pressable onPress={() => Linking.openURL(preset.keyUrl!).catch(() => {})} accessibilityRole="link">
            <Text style={{ color: t.brand, fontWeight: "700", textAlign: tx.textAlign ?? "right" }}>{cfg.preset === "gemini" ? tr("ai.getGeminiKey") : tr("ai.getKey", { name: preset.label })}</Text>
          </Pressable>
        ) : null}
        <Hint>{tr("ai.keyHint")}</Hint>
      </View>

      <View style={{ gap: 6 }}>
        {label(tr("ai.model"))}
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <TextInput value={cfg.model} onChangeText={v => setCfg({ ...cfg, model: v.trim() })} placeholder={tr("ai.modelPh")} autoCapitalize="none" autoCorrect={false} accessibilityLabel={tr("ai.model")} style={[input, { flex: 1 }]} placeholderTextColor={t.ink2} />
          <Button kind="ghost" title={tr("ai.loadModels")} onPress={loadModels} style={{ height: 42, paddingHorizontal: 10 }} />
        </View>
        {listErr ? <Hint bad>{listErr}</Hint> : null}
        {list?.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {list.map(m => <Chip key={m} role="radio" on={cfg.model === m} label={m} onPress={() => { setCfg({ ...cfg, model: m }); setResult(null); }} />)}
          </View>
        ) : null}
        {cfg.preset === "gemini" ? <Hint>{tr("ai.geminiModelHint")}</Hint> : null}
      </View>

      <Button title={testing ? tr("ai.testing") : tr("ai.test")} onPress={runTest} disabled={testing} />
      {result ? <Hint bad={!result.ok}>{result.ok ? `✓ ${result.msg}` : result.msg}</Hint> : null}

      <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10 }}>
        {label(tr("ai.deals"))}
        <Hint>{tr("ai.dealsHint")}</Hint>
        {status.running ? <Hint>{tr("ai.running", { done: status.done, total: status.total })}</Hint> : null}
        {status.error ? <Hint bad>{tr("ai.error", { msg: status.error })}</Hint> : null}
        {s.yes + s.no + s.unclear ? <Hint>{tr("ai.stats", { yes: s.yes, no: s.no, unclear: s.unclear })}</Hint> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {status.running ? <Button kind="ghost" title={tr("common.cancel")} onPress={cancel} style={{ flex: 1 }} /> : null}
          {s.yes + s.no + s.unclear ? <Button kind="ghost" title={tr("ai.clear")} onPress={clear} style={{ flex: 1 }} /> : null}
        </View>
      </View>
      <Hint>{tr("ai.privacy")}</Hint>
    </SettingsSection>
  );
}
