# Enterprise Compute Quota Governance Demo Proof

This proof artifact is designed for reviewer understanding, not only for file
presence. It uses the synthetic data in `sample-data.json`; it does not claim to
show production usage or a live SCIBASE deployment.

## What to Review

- `docs/demo.mp4` is a 40 second walkthrough of the quota governance path.
- `docs/demo.svg` is a static companion summary for quick inspection.
- `npm run demo` prints the same portfolio, review queue, API, export, and
  webhook evidence used by the visual artifacts.

The demo should make these claims understandable without reading the code:

- quota policy thresholds produce warning, critical, and blocked states;
- project compute and storage forecasts are compared with configured limits;
- quota risk becomes admin review queue decisions;
- REST API routes are scoped for dashboard, review, project detail, decision,
  and export manifest access;
- CSV/export manifest data is available for finance and compliance review;
- review-required webhook events are HMAC signed from synthetic sample data.

## Validation Steps

```sh
cd enterprise-compute-quota-governance
npm run check
npm test
npm run demo
git diff --check
```

Expected validation signal:

- `npm run check` validates `index.js`, `demo.js`, and `test.js` syntax.
- `npm test` verifies risk counts, approval queue order, requested decisions,
  API routes, CSV export rows, manifest targets, custom tags, webhook
  signatures, stable JSON serialization, and policy validation errors.
- `npm run demo` prints reviewer-readable sample output.

## Sample Output Excerpt

```text
Enterprise Compute Quota Governance Demo
Institution: Northbridge Research University
Period: 2026-Q2

Portfolio
- Projects: 4
- Forecast GPU hours: 3321
- Projected storage GB: 15010
- Forecast cost USD: 12257
- Risk counts: {"normal":0,"warning":2,"critical":1,"blocked":1}

Top review queue
- BLOCKED microscopy-foundation-model: block-and-escalate
- CRITICAL climate-preprint-replication: approve-extension-or-reduce-forecast
- WARNING neuro-open-atlas: review-before-next-allocation-cycle
- WARNING river-sensor-elns: review-before-next-allocation-cycle
```

## Proof Boundary

The MP4 is valid proof only if it remains human-understandable and directly tied
to this PR's claim. If the video becomes stale or unclear, use this Markdown file
and the validation commands as the primary proof rather than treating a playable
video file as sufficient by itself.
