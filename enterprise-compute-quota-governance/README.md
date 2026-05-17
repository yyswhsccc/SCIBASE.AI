# Enterprise Compute Quota Governance

This module adds a focused Enterprise Tooling slice for institutional compute and
storage governance. It helps admins see which labs, departments, and projects
are approaching or exceeding GPU and storage allocations, then turns those
signals into approval queue items, dashboard metrics, webhook events, and
export-ready evidence.

## Why this fits Issue #19

The issue calls for admin dashboards, usage stats, custom flags, API/webhook
integration, and export pipelines. This slice covers that surface without
duplicating the existing open PRs for broad dashboards, export packaging,
webhook replay, trust center, compliance packets, identity drift, retention,
grant compliance, data residency, SLA monitoring, lab inventory, or secret
rotation.

## What is included

- Portfolio dashboard metrics for GPU hours, storage, forecast cost, risk bands,
  departments, cost centers, and top at-risk projects.
- Deterministic quota evaluation for warning, critical, and blocked states.
- Admin approval queue with requested decisions and action recommendations.
- REST API catalog for dashboard, review queue, project detail, decision, and
  export manifest routes, including service scopes and integration clients.
- Custom tag preservation for grant, doctoral, restricted-data, ELN sync,
  open-science, and reproducibility initiatives.
- Export manifest for institutional dashboards, finance chargeback ledgers,
  compliance archives, workflow webhooks, and the REST API catalog.
- HMAC-signed webhook payloads using synthetic sample data only.

## Local verification

```sh
cd enterprise-compute-quota-governance
npm run check
npm test
npm run demo
```

The implementation uses only Node.js built-ins and has no install step.

## Demo output

`npm run demo` prints the portfolio summary, review queue, REST API routes, and
signed webhook event IDs. A static visual preview is available in `docs/demo.svg`;
the PR also includes `docs/demo.mp4` as a short reviewer demo artifact.
