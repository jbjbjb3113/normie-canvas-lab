/**
 * Cloudflare Worker example for generic ElevenLabs TTS.
 *
 * Required secret:
 *   wrangler secret put ELEVENLABS_API_KEY
 *
 * Optional usage:
 *   POST /v1/text-to-speech/:voiceId
 *   Body: { text, model_id?, voice_settings? }
 *   Header (optional): xi-api-key (user override; if absent uses server secret)
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, xi-api-key",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const m = url.pathname.match(/^\/v1\/text-to-speech\/([^/]+)$/);
    if (!m) return new Response("Not Found", { status: 404 });
    const voiceId = m[1];

    const callerKey = request.headers.get("xi-api-key")?.trim();
    const apiKey = callerKey || env.ELEVENLABS_API_KEY;
    if (!apiKey) return new Response("Missing ElevenLabs key", { status: 500 });

    const bodyText = await request.text();
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": apiKey,
        },
        body: bodyText,
      },
    );

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Headers", "Content-Type, xi-api-key");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "audio/mpeg");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
