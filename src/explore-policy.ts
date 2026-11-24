import { parse, visit, Kind } from "graphql";

const verbs = "create|update|delete|remove|insert|upsert|mutate|publish|unpublish|send|submit|save|archive|restore|approve|reject|assign|unassign|mark|toggle|set|add|invite|logout|login|signout|signoff|reset|upload|download|track|record|sync|acknowledge|dismiss|complete|register";
const writes = new RegExp("^(?:"+verbs+"|"+verbs.split("|").map(v=>v[0].toUpperCase()+v.slice(1)).join("|") + ")(?:$|[_-]|[A-Z])");
const riskyPath = /(?:^|\/)(?:create|update|delete|remove|publish|send|submit|save|archive|logout|signout|mark-read|upload|download|students|student|messages|messaging|behaviour|behavior|grades|gradebook|reports|progress-reports)(?:\/|$)/i;

export function queryOnly(source: unknown): boolean {
  if (typeof source !== "string" || !source.trim() || source.length > 200000) return false;
  try {
    const ast = parse(source);
    const operations = ast.definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
    if (!operations.length || operations.some(d => d.operation !== "query")) return false;
    if (ast.definitions.some(d => d.kind !== Kind.OPERATION_DEFINITION && d.kind !== Kind.FRAGMENT_DEFINITION)) return false;
    let safe = true;
    visit(ast, {
      OperationDefinition(node) { if(node.name && writes.test(node.name.value)) safe = false; },
      Field(node) { if(writes.test(node.name.value)) safe = false; }
    });
    return safe;
  } catch { return false; }
}

export function requestAllowed(method: string, raw: string, body: unknown, documentOrigin: string, navigation: boolean): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    if (u.hostname !== "toddleapp.com" && !u.hostname.endsWith(".toddleapp.com")) return false;
    if (navigation && u.origin !== documentOrigin) return false;
    if (riskyPath.test(decodeURIComponent(u.pathname))) return false;
    if (u.searchParams.has("mutation") || u.searchParams.has("action")) return false;
    if (method === "GET" || method === "HEAD") {
      if (u.searchParams.has("query")) return queryOnly(u.searchParams.get("query"));
      if (u.searchParams.has("operationName") || u.searchParams.has("extensions")) return false;
      return true;
    }
    if (method === "OPTIONS") return true;
    if (method !== "POST" || navigation || !body || typeof body !== "object" || Array.isArray(body)) return false;
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some(k => !["query","variables","operationName","extensions"].includes(k))) return false;
    if (data.operationName && (typeof data.operationName !== "string" || writes.test(data.operationName))) return false;
    return queryOnly(data.query);
  } catch { return false; }
}

export function inPlatform(raw: string, origin: string, platformId: string): boolean {
  try {
    const u = new URL(raw);
    if (u.origin !== origin || u.username || u.password) return false;
    return (u.pathname === "/platform/" + platformId || u.pathname.startsWith("/platform/" + platformId + "/")) && !riskyPath.test(decodeURIComponent(u.pathname));
  } catch { return false; }
}
