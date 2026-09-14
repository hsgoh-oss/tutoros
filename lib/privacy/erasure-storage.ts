/** Resolve only this tenant's objects in known buckets. Other hosts require external evidence. */
export function erasureObject(bucket: string, location: string, tenantId: string, storageOrigin: string):
  | { kind: "object"; bucket: string; path: string }
  | { kind: "external" }
  | { kind: "invalid" } {
  if (!["homework", "materials", "reviews", "review-evidence"].includes(bucket)) return { kind: "invalid" };
  let path = location;
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try { url = new URL(path); } catch { return { kind: "invalid" }; }
    if (url.origin !== new URL(storageOrigin).origin) return { kind: "external" };
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match || ![bucket, ...(bucket === "review-evidence" ? ["reviews"] : [])].includes(match[1])) return { kind: "invalid" };
    try { path = decodeURIComponent(match[2]); } catch { return { kind: "invalid" }; }
  } else if (path.startsWith("/img/")) {
    return { kind: "external" }; // Static/legacy evidence requires an explicit manual check.
  }
  if (!path.startsWith(`${tenantId}/`) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return { kind: "invalid" };
  return { kind: "object", bucket, path };
}
