import { z } from "zod";

// Opaque keyset cursors: base64url of [list, sort key, id]. Bound to one list, so a
// cursor from another list or a tampered one is a validation error (422), never a scan.
export const PAGES = {
  incidents: { table: "incidents", columns: "*", sort: "opened_at", id: "id", sortField: "opened_at", idField: "id", limit: 20 },
  notifications: { table: "notifications", columns: "*", sort: "created_at", id: "id", sortField: "created_at", idField: "id", limit: 50 },
  knowledge: {
    table: "knowledge_entries",
    columns: "id,incident_id,content,confirmed_by,confirmed_at,version",
    sort: "confirmed_at",
    id: "id",
    sortField: "confirmed_at",
    idField: "id",
    limit: 100,
  },
  telemetry: {
    table: "telemetry",
    columns: "id,service_id,provider,kind,status,summary,observed_at,fetched_at,expires_at",
    sort: "fetched_at",
    id: "id",
    sortField: "fetched_at",
    idField: "id",
    limit: 100,
  },
  // Audit rows are append-only with an increasing integer ID.
  audit: { table: "audit_logs", columns: "id,action,outcome,created_at", sort: "id", id: "id", sortField: "id", idField: "id", limit: 100 },
} as const;
export type PageKind = keyof typeof PAGES;

export const pageQuerySchema = z
  .object({
    cursor: z.string().min(1).max(400).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export function encodeCursor(kind: PageKind, key: string | number, id: string) {
  return btoa(JSON.stringify([kind, key, id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function decodeCursor(kind: PageKind, raw: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    decoded = null;
  }
  const [, key, id] = z
    .tuple([
      z.literal(kind),
      kind === "audit" ? z.number().int().positive() : z.string().min(1).max(64),
      z.string().min(1).max(200),
    ])
    .parse(decoded);
  return { key, id: kind === "audit" ? Number(id) : id };
}
