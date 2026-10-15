/*
 * Discord Webhook Relay — Cloudflare Worker
 *
 * Render (and most cloud hosts) use shared outbound IPs that Discord's
 * Cloudflare rate-limits with "Error 1015 / You are being rate limited".
 * This Worker runs on Cloudflare's own network, so forwarding uploads
 * through it sidesteps that IP block.
 *
 * The FileVault server posts its multipart upload here (set its
 * WEBHOOK_URL to this Worker's URL); the Worker forwards the request
 * body verbatim to the real Discord webhook.
 *
 * Configuration (set in the Cloudflare dashboard — see worker/README.md):
 *   DISCORD_WEBHOOK_URL  (required) the real Discord webhook URL
 *   RELAY_SECRET         (optional) shared token; when set, callers must
 *                        send it in the X-Relay-Secret header
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed. POST an upload here.', { status: 405 });
    }

    if (!env.DISCORD_WEBHOOK_URL) {
      return new Response('Relay not configured: DISCORD_WEBHOOK_URL is missing.', { status: 500 });
    }

    // Optional shared-secret check so only your server can use this relay.
    if (env.RELAY_SECRET) {
      const provided = request.headers.get('x-relay-secret');
      if (provided !== env.RELAY_SECRET) {
        return new Response('Unauthorized.', { status: 401 });
      }
    }

    // Forward the incoming multipart body verbatim to Discord. The
    // Content-Type header carries the multipart boundary, so pass it through.
    const contentType = request.headers.get('content-type') || 'application/octet-stream';
    const body = await request.arrayBuffer();

    let discordResponse;
    try {
      discordResponse = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'User-Agent': 'FileVault-Relay (Cloudflare Worker)'
        },
        body
      });
    } catch (err) {
      return new Response('Relay failed to reach Discord: ' + err.message, { status: 502 });
    }

    // Pass Discord's status and body straight back to the caller.
    const text = await discordResponse.text();
    return new Response(text, {
      status: discordResponse.status,
      headers: {
        'Content-Type': discordResponse.headers.get('content-type') || 'text/plain'
      }
    });
  }
};
