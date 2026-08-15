# Deploying the mock webhook server (Step 2)

This is a tiny, zero-dependency Node server (`server.js`) that implements all 7 tools from
`vapi_tool_schemas.json` with canned data for the Rahul Sharma demo scenario. No `npm install`
needed — it only uses Node's built-in `http` module. Tested locally and confirmed working.

## Option A — Replit (recommended, fastest)

1. Go to **replit.com**, sign up/log in, click **Create App / Create Repl**.
2. Choose the **Node.js** template.
3. Delete whatever's in the default `index.js` (or `server.js`) and paste in the contents of
   `server.js` from this folder. Make sure the file is named `server.js` (or update the run command).
4. In Replit's shell/console, make sure it runs with: `node server.js`
   (Replit usually auto-detects this from `package.json`'s `main`/`start` — if it complains, just
   add a `.replit` file with `run = "node server.js"`, or set the Run command directly in Replit's settings.)
5. Click **Run**. Replit will show a webview URL at the top, like
   `https://kapture-mock-webhook.yourusername.repl.co` — that's your public base URL.
6. **Keep the Repl open/running** while you make your Vapi test call — free Replit repls sleep when
   idle, so re-open it right before you record your demo to make sure it's awake. (If this is a
   problem, Replit's "Deployments" feature can give you a stable always-on URL, or use Option B.)

## Option B — Render.com (free tier, more stable uptime)

1. Push this `mock-server` folder to a new GitHub repo (or use Render's "Deploy from folder" if available).
2. On render.com, **New > Web Service**, connect the repo.
3. Environment: Node. Build command: (leave blank / `echo "no build needed"`). Start command: `node server.js`.
4. Deploy. Render gives you a URL like `https://kapture-mock-webhook.onrender.com`.
5. Note: Render's free tier can take ~30-60s to "wake up" on the first request after being idle —
   call the base URL once in your browser a minute before your Vapi test call to warm it up.

## Option C — Run it on your own machine + expose it with ngrok

If you have Node installed locally and don't want to sign up for a hosting service:

1. `cd mock-server && node server.js` (runs on `http://localhost:3000`).
2. In another terminal: `npx ngrok http 3000` (or install ngrok separately).
3. ngrok prints a public URL like `https://abcd1234.ngrok-free.app` — that forwards to your
   local server. Use that as the base URL in Vapi.
4. Keep both terminals running while you test/record.

## Point Vapi at it

Whichever option you use, you now have a base URL. In Vapi's Functions config, for each of the 7
functions in `vapi_tool_schemas.json`, set `server.url` to:

```
<your-base-url>/tools/<function_name>
```

For example:
```
https://kapture-mock-webhook.yourusername.repl.co/tools/verify_customer
https://kapture-mock-webhook.yourusername.repl.co/tools/get_account_details
https://kapture-mock-webhook.yourusername.repl.co/tools/log_promise_to_pay
https://kapture-mock-webhook.yourusername.repl.co/tools/send_payment_link
https://kapture-mock-webhook.yourusername.repl.co/tools/escalate_to_agent
https://kapture-mock-webhook.yourusername.repl.co/tools/mark_disposition
https://kapture-mock-webhook.yourusername.repl.co/tools/check_call_window
```

## Test it before wiring Vapi to it

Once deployed, sanity-check from your own browser/terminal:

```bash
curl -X POST https://<your-base-url>/tools/verify_customer \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+919999999999","spoken_dob":"1990-04-15","spoken_pincode":"500034"}'
```

Expected response: `{"match":true,"match_factors":2,"customer_id":"cust_rahul_001"}`

This is the exact DOB (`1990-04-15`) and pincode (`500034`) you should tell the bot during your
test call to pass authentication. If you want to test the auth-failure path, just say a different
date of birth.

## Testing edge cases without redeploying

Two admin controls are built in — call these before your demo call to set up a scenario:

- **Already-paid path:** 
  `curl -X POST <base-url>/admin/set-status -H "Content-Type: application/json" -d '{"payment_status":"paid"}'`
  Then call the bot — `get_account_details` will report the loan as already paid.

- **Do-not-call path:**
  `curl -X POST <base-url>/admin/set-status -H "Content-Type: application/json" -d '{"dnc":"+91<your-test-number>"}'`
  Then `check_call_window` will report `allowed:false` for that number.

Restart the server (or redeploy) to reset state back to the default overdue scenario.

## What the demo scenario's "correct" auth answers are

Hard-coded in `server.js` — say these during your test call to pass authentication:
- Date of birth: **1990-04-15**
- Last 4 digits (loan/PAN): **4321**
- Pincode: **500034**

Only 2 of these 3 need to match, per the HLD's two-factor design.
