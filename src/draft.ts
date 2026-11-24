export const kinds = ["lesson_plan", "announcement", "assignment", "message"] as const;
export type Kind = typeof kinds[number];

export function previewDraft(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid draft");
  const v = input as Record<string, unknown>;
  if (!kinds.includes(v.kind as Kind)) throw new Error("Invalid kind");
  function field(key: string, max: number) {
    const s = v[key];
    if (typeof s !== "string" || !s.trim() || s.length > max) throw new Error("Invalid " + key);
    return s.trim();
  }
  return {
    kind: v.kind as Kind, destination: field("destination", 150),
    title: field("title", 200), body: field("body", 20000),
    status: "preview_only", published: false
  } as const;
}
