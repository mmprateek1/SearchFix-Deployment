# Test SearchFix 1.6.0

## Offline model tests and preview

1. Run TEST-SearchFix.cmd (or node --test tests/*.test.js). AI calls are mocked; no real key is needed.
2. Run PREVIEW-SearchFix.cmd and open http://127.0.0.1:4173/tests/browser/panel-preview.html.
3. Click Scan the page. Five synthetic orders appear.
4. Save the dummy key AQ.TEST_ONLY_12345678901234567890 in this preview only.
5. Click Start analysis for one order. Other orders remain Pending. Each button runs only its order; previous findings remain visible.
6. The demo covers Ignored, Accepted with evidence, Disputed, Review required, and an Accepted operational task without documents. Expand Chosen comment and inspect the explanation and next steps. These outcomes are simulated.

## Run the real extension against a local backend

The packaged extension currently targets Render. For local development, run:

    node scripts/configure-backend.mjs http://127.0.0.1:3000

Install dependencies with npm ci if needed. Start START-SearchFix.cmd and keep its window open. Check http://127.0.0.1:3000/health for version 1.6.0. Reload the project's extension folder in chrome://extensions. Sign in to DataTrace, scan the task queue, save your key and choose one Start analysis button.

When returning to the hosted service, run:

    node scripts/configure-backend.mjs https://searchfix-deployment.onrender.com

Then reload the extension and rebuild the extension ZIP before distributing it. Configuration changes do not deploy backend code. Node.js 22 through 26 are supported by package.json.

## Diagnose a result

The chosen comment includes how many comments were received and how many AI considered. Check that selection first. For a discrepancy, look for document names and evidence citations. Downloaded alone does not mean analyzed. Review required explains missing files or uncertainty; no successful decision is invented to conceal a failure.

The Activity log and backend logs share request IDs. pdf.download.complete and a positive evidence.received file count confirm attachment bytes reached the backend. Gemini extraction and document findings confirm later processing. Logs omit key values and document contents. Copy findings only writes to your clipboard.

The real search team should check results against current evidence. Mocked tests do not prove live Gemini interpretation or availability. No website writes are part of any workflow.
