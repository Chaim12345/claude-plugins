import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX, clearLog, dlog, logLines, logText } from "./debuglog.ts";

test("debug log: ring buffer, data encoded and shortened, text export with header and filter", () => {
  clearLog();
  for (let i = 0; i < MAX + 10; i++) dlog("sync", `line ${i}`);
  assert.equal(logLines().length, MAX);
  assert.equal(logLines()[0].msg, "line 10");
  clearLog();
  dlog("sync", "download", { store: "RamiLevi:16", bytes: 1024 });
  dlog("error", "x".repeat(2000));
  assert.match(logLines()[0].msg, /^download \{"store":"RamiLevi:16","bytes":1024\}$/);
  assert.ok(logLines()[1].msg.length < 1300);
  const t = logText({ app: "1.0.0", place: "רמת גן", empty: "", none: null });
  assert.match(t, /app: 1\.0\.0\nplace: רמת גן\n/);
  assert.doesNotMatch(t, /empty|none/);
  assert.match(t, /\[sync\] download/);
  assert.doesNotMatch(logText({}, "sync"), /\[error\]/);
  clearLog();
});
