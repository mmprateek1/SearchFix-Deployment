# SearchFix 1.5.0 — local development

Start with [LOCAL_TESTING.md](LOCAL_TESTING.md) for the demo, local service, Chrome installation and testing steps. Read [REFERENCE_DATA_REVIEW.md](REFERENCE_DATA_REVIEW.md) for the detailed analysis of the supplied files.

## Run locally

1. Install dependencies once with `npm ci`.
2. Double-click `START-SearchFix.cmd` and keep it open.
3. Load or reload the `extension` folder in `chrome://extensions`.
4. Open the DataTrace task queue and click **Scan the page**.
5. Enter and save your Gemini key using the button that appears after scanning.
6. Click **Start the search fix**. Read each order's colored status and expandable findings.

The local launcher binds only to 127.0.0.1:3000. No server default key is used. Keys stay in extension session storage and are isolated per request. Both AIza and AQ. formats are supported; the key is saved locally without an API test.

## Reference support

The backend uses only the September 29 Consolidated SearchFix Report.xlsx. All 1,809 labeled rows were examined; 1,794 records remain eligible as examples after blank comments, duplicates and conflicting labels are excluded. All 53 named normalized categories are covered by the explicit issue catalogue. See [ISSUE_DOCUMENT_MAP.md](ISSUE_DOCUMENT_MAP.md) for all 59 issue types and their required evidence.

Comment classification and final evidence comparison receive relevant examples and category guidance. Results include the business category and historical source-row references. This is reference-guided analysis, not fine-tuning. Historical corrections, counts and matching order IDs never substitute for current documents. The same category can produce Accepted or Disputed.

The original files remain unchanged. The prepared library is in `data/reference` and must accompany the backend. It is not embedded in the extension. The internal history file is excluded from Git by default but included in the local setup package.

## Preserved behavior

- Comments start with `gemini-3.5-flash-lite`; document analysis and evidence decisions start with `gemini-3.5-flash`. Both use the ordered fallback chains below.
- Selected internal-user comments, including ADSSearchType and ADSSP2, are ignored before AI calls. Fee-only approval requests, abstractor status/ETA-only updates and explicit no-revision requests finish Disputed without document analysis. Mixed substantive claims still need current evidence.
- Unsupported claims return Review required with a manual-classification explanation; there is no catch-all issue or default document mapping.
- Required PDFs come from the verified order's Attachments view. TA comes only from Typing Assistant text.
- Missing/unreadable evidence leads to Review required and the queue continues.
- No DataTrace task claiming, status changes, field edits, uploads, comment posting or TA unlocking.

Numeric filename prefixes vary. Pacer, Patriot, Search Package, Index Snapshot, THR and Cost Work Sheet are recognized by type. INDEX is independently required where mapped; Search Package cannot substitute for it. Only relevant required files are downloaded.

Existing boundaries remain: loaded queue/comment rows only, no automatic pagination, six PDFs, 20 MB each and 40 MB total. Keep the panel open; closing it interrupts processing and clears results. Analysis sessions expire after 30 minutes or a service restart.

## Model fallback

The ordered candidates are defined in `src/config/modelFallbacks.js`:

- Text/comments: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-3.5-flash`.
- Documents/evidence decisions: `gemini-3.8-flash` → `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-2.5-flash`.

Each request checks the chain in order and skips models whose reserved RPM, TPM or RPD budget cannot fit it. Only eligible models receive requests. Unavailable models (404), rate limits (429), temporary server failures (500/502/503/504) and recognized temporary network failures advance to the next candidate. The final candidate retains up to three attempts with 1-second then 2-second backoff for transient failures. Invalid requests or credentials (400/401/403) stop immediately. If all candidates fail, the existing failure/review handling applies.

The supplied AI Studio limits are configured with a 20% buffer. Token preflight, saved counters and retry accounting are described in [RATE_LIMITS.md](RATE_LIMITS.md). The extension saves your key immediately and makes no verification calls, including when Start is pressed. The first Gemini calls are for the actual analysis. All attempts preserve the entered key, prompts and evidence. Legacy single-model environment settings are ignored so they cannot override this order. These are requested candidate identifiers; runtime access depends on the provider and account, and fallback does not guarantee additional quota.

## Checks and API

Use `TEST-SearchFix.cmd` or `node --test tests/*.test.js`. Use `PREVIEW-SearchFix.cmd` for the synthetic UI demo. Mocked checks do not establish live model accuracy.

API routes remain `/api/searchfix/validate-key`, `/analyze-comments`, `/analyze-documents` and `/analyze`. All require the supplied `X-SearchFix-Gemini-Key`. `/health` reports version and service availability. The response's `references` field identifies the consulted sources, library version and matched example locations.
