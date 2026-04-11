/**
 * Proxy Normies API under /api (same-origin in the browser).
 * Static assets under /assets are excluded via public/_routes.json so JS/CSS bypass Functions.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/api")) {
    return await context.next();
  }
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const target = new URL(path + url.search, "https://api.normies.art");
  const headers = new Headers();
  const accept = context.request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  return fetch(target.toString(), {
    method: context.request.method,
    headers,
    redirect: "follow",
  });
}
