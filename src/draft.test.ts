import { test } from "node:test";
import assert from "node:assert/strict";
import { previewDraft } from "./draft.ts";

test("valid preview never publishes", () => {
  const p = previewDraft({ kind: "lesson_plan", destination: "Demo class", title: "Lesson", body: "Review" });
  assert.equal(p.published, false);
  assert.equal(p.status, "preview_only");
});
test("rejects unsupported kind and missing content", () => {
  assert.throws(() => previewDraft({ kind: "delete" }));
  assert.throws(() => previewDraft({ kind: "message", destination: "Demo", title: "Test", body: " " }));
});
