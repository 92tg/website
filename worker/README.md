# Discord Webhook Relay (Cloudflare Worker)

Render's shared outbound IP gets blocked by Discord's Cloudflare with
**Error 1015 ("You are being rate limited")**. This Worker runs on
Cloudflare's own network, so forwarding uploads through it avoids the block.

Flow: **FileVault server → this Worker → Discord webhook**

## 1. Create the Worker

Use **one** of the two methods below. Do **not** drag-and-drop or upload
`worker.js` into the dashboard — that triggers the error "This uploader does
not yet support projects that require a build process." The code must be
**pasted into the online editor** (Method A) or deployed with **wrangler**
(Method B).

### Method A — Cloudflare dashboard (no CLI)

1. Go to <https://dash.cloudflare.com> and sign in (free account is fine).
2. In the left sidebar open **Compute (Workers)** → **Workers & Pages**.
3. Click **Create** → **Workers** → **Start with Hello World!** (the plain
   template — not "Import a repository" and not an assets/Pages option).
4. Give it a name, e.g. `discord-relay`, and click **Deploy**.
5. Click **Edit code**. Select all the starter code and delete it, then paste
   the full contents of [`worker.js`](worker.js) and click **Deploy**.

Your Worker now has a URL like `https://discord-relay.<your-subdomain>.workers.dev`.
Copy it — you'll need it in step 3.

### Method B — wrangler CLI (if Method A gives you trouble)

From inside the `worker/` folder:

```bash
npx wrangler login
npx wrangler deploy
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put RELAY_SECRET
```

`npx wrangler deploy` reads [`wrangler.toml`](wrangler.toml), uploads
`worker.js`, and prints the Worker URL. The two `secret put` commands prompt
you to paste each value (skip `RELAY_SECRET` if you aren't using one). With
this method you can skip step 2 below — the secrets are already set.

## 2. Add the secrets

In the Worker, open **Settings** → **Variables and Secrets** and add:

| Name                  | Type   | Value                                            |
| --------------------- | ------ | ------------------------------------------------ |
| `DISCORD_WEBHOOK_URL` | Secret | your real Discord webhook URL                    |
| `RELAY_SECRET`        | Secret | any long random string (optional but recommended)|

Click **Deploy** / **Save** after adding them.

> `RELAY_SECRET` stops strangers who find your Worker URL from spamming your
> Discord channel. If you set it here, set the **same** value on Render in
> step 3. If you skip it, the relay works but is open to anyone who learns
> the URL.

## 3. Point the server at the Worker

In your **Render** service → **Environment**, set:

| Name           | Value                                                        |
| -------------- | ----------------------------------------------------------- |
| `WEBHOOK_URL`  | the Worker URL from step 1 (NOT the Discord URL anymore)     |
| `RELAY_SECRET` | the same value you set in step 2 (only if you set one)       |

Keep `STORAGE_MODE=webhook`. Save — Render redeploys automatically.

## 4. Test

Upload a file on your site. It should deliver to Discord. If it fails,
check **Render → Logs** for the `Webhook delivery failed:` line, and the
Worker's own logs under **Workers & Pages → your Worker → Logs**.

### Quick manual test (optional)

```bash
curl -X POST "https://discord-relay.<your-subdomain>.workers.dev" \
  -H "X-Relay-Secret: <your RELAY_SECRET>" \
  -F 'payload_json={"content":"relay test"}'
```

A `204` response means the relay reached Discord successfully.
