/**
 * Proxy Normies API under /api so the browser talks same-origin (avoids CORS on pages.dev etc.).
 * GET https://<host>/api/normie/1/canvas/diff → https://api.normies.art/normie/1/canvas/diff
 */
type PagesMiddleware = {
  request: Request;
  next: () => Promise<Response>;
};

export async function onRequest(context: PagesMiddleware): Promise<Response> {
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
