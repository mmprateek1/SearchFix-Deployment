# Deploy SearchFix 1.6.0 on Render

The Node.js backend runs on Render. The Chrome extension stays on each user's PC and reads DataTrace through that user's signed-in browser. The extension sends relevant comments, PDFs, TA text, and the entered API key to your Render service over HTTPS; that service calls Gemini. It does not write anything back to DataTrace. This guide prepares a deployment; no service has been published for you.

## 1. Prepare the project and approved keys

Use the full project or extract `SearchFix-setup.zip`. Install Node.js 22 and run `npm ci` in the project folder. Upload the source to a private GitHub repository that Render can access. Keep `.env`, credentials, `node_modules`, and real order files out of Git. `.env.example` contains configuration guidance only.

To authorize your Gemini key on the hosted server, run:

```text
node scripts/hash-gemini-key.mjs
```

Paste your key into the hidden terminal input and press Enter. Copy the 64-character SHA-256 fingerprint it prints. The script does not save or print the key. Each colleague can generate their own fingerprint; join multiple fingerprints with commas. The fingerprint approves the key but cannot be used instead of the actual key to call Gemini.

## 2. Create the Render service

In Render, choose **New → Web Service**, connect the repository, and select the branch containing this version. Use these settings:

| Setting | Value |
| --- | --- |
| Language/runtime | Node |
| Root directory | Leave blank if package.json is at the repository root |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/health` |
| Instances | 1 |

Add these environment variables:

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `GEMINI_COMMENT_MODEL` (legacy; active chain is in source) | `gemini-3.5-flash-lite` |
| `GEMINI_DOCUMENT_MODEL` (legacy; active chain is in source) | `gemini-3.5-flash` |
| `ALLOWED_GEMINI_KEY_HASHES` | Your fingerprint, or comma-separated approved fingerprints |

Do not add `GEMINI_API_KEY`: this version never uses a server default key. Render supplies `PORT`; the app listens on `0.0.0.0`. The server accepts an approved fingerprint list or the existing * configuration; * allows any supplied key. Keep your existing access configuration unless intentionally changing it. The included `render.yaml` provides the same configuration if you prefer Render's Blueprint flow. [Render Node deployment](https://render.com/docs/deploy-node-express-app), [web service configuration](https://render.com/docs/web-services), [Blueprint specification](https://render.com/docs/blueprint-spec).

Choose the service plan in Render. For regular team use, choose an always-on plan appropriate to your workload; Render describes its free instances as unsuitable for production and they can spin down when idle. [Free instance limitations](https://render.com/docs/free).

Click **Deploy Web Service**. Wait for deployment to finish and copy the assigned HTTPS URL, such as `https://YOUR-SERVICE.onrender.com`. This is a placeholder: use your actual URL in every step below.

## 3. Confirm service availability

Open `https://YOUR-SERVICE.onrender.com/health`. Expected response:

```json
{"status":"OK","version":"1.6.0","credentialMode":"request-key-only"}
```

This proves the service is running, not that your Gemini account has model access. Saving a key makes no verification request; model access is tested during actual analysis. Quota counters use data/runtime/gemini-usage.json and need persistent storage to survive replacement of the server filesystem. Analysis sessions are held in memory for up to 30 minutes, so keep one instance. A restart or deployment clears those sessions; finish active analyses before deploying, or rerun affected orders afterward. [Render health checks](https://render.com/docs/health-checks).

## 4. Connect and package the extension

On your development PC, open a terminal in the project folder and run this with the real service URL:

```text
node scripts/configure-backend.mjs https://YOUR-SERVICE.onrender.com
```

This updates `extension/deployment.js` and the extension's permission for the exact server hostname. It also updates the unpacked release copy if present. No key is embedded. There is no connection field in the panel anymore. The current ZIP already targets https://searchfix-deployment.onrender.com; run this only when changing its destination.

Create a fresh distribution ZIP in PowerShell:

```powershell
Compress-Archive -Path extension -DestinationPath SearchFix-extension.zip -Force
```

Send this **newly configured ZIP** to the other PCs. On each PC:

1. Extract it into a permanent folder.
2. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the extracted `extension` folder. For an existing installation, replace its files and click **Reload**.
3. Sign in to DataTrace normally and open SearchFix.
4. Click the green **Add Gemini API key**, paste the actual approved key, and select **Use this key**.
5. The key is saved immediately without verification requests.
6. Scan the task queue and choose Start analysis beside one order.

These PCs do not need Node.js, a `.env` file, or a local SearchFix server. Each user's key is retained only for the browser session; reenter it after a browser restart or extension update. A missing or rejected key blocks analysis, with no fallback to an old key or a server key.

## 5. Updates and access changes

- **Backend update:** push the changed backend to the connected branch. If Render automatic deployment is enabled, it deploys that commit. Otherwise use Render's manual deployment control. Verify `/health` afterward. [Render deployment workflow](https://render.com/docs/deploy-node-express-app).
- **Extension update:** increase the extension manifest version, preserve the hosted configuration, build a new ZIP, and replace/reload it on each PC. Updating Render alone cannot update installed extension files.
- **Automatic extension updates:** distribute through the same Chrome Web Store item for future releases; see [SETUP_AND_UPDATES.md](SETUP_AND_UPDATES.md). The current unpacked ZIP does not have an automatic updater.
- **Approve/revoke a key:** add/remove its fingerprint in `ALLOWED_GEMINI_KEY_HASHES` and apply the updated Render environment configuration. Requests are checked against that list each time. The server does not need the raw key stored in its environment.

## Troubleshooting

| Message or symptom | Action |
| --- | --- |
| Key is not approved for this server | Generate the fingerprint from that exact key; add it to Render's approved list and apply the configuration. |
| Invalid key, model access denied, model unavailable, or quota error | Check the entered key and its Google project access/quota for both configured models. The UI shows the failure; it never substitutes a default key. |
| Backend does not support key verification | Deploy this backend version. Locally, stop the old process and restart with this code. Reload the extension too. |
| Unable to reach the service | Check Render service status, its actual URL, and that the configuration script was run before rebuilding/reloading the extension. |
| Production service refuses to start | Check `ALLOWED_GEMINI_KEY_HASHES`: each entry must be exactly 64 hexadecimal characters. |
| Expired analysis session | Restart the analysis for that order; deployment/restarts clear the in-memory session. |

Live Render deployment and real Gemini account access have not been tested as part of this build. Automated tests use synthetic keys and mocked model responses.
