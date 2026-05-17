"use strict";

const assert = require("node:assert/strict");
const sampleData = require("./sample-data.json");
const { evaluateQuotaGovernance, signPayload, stableStringify } = require("./index");

const result = evaluateQuotaGovernance(sampleData);

assert.equal(result.institution, "Northbridge Research University");
assert.equal(result.period, "2026-Q2");
assert.deepEqual(result.policy.webhookSecret, "<redacted>");

assert.equal(result.dashboard.portfolio.projectCount, 4);
assert.deepEqual(result.dashboard.portfolio.riskCounts, {
  normal: 0,
  warning: 2,
  critical: 1,
  blocked: 1
});

assert.equal(result.approvalQueue.length, 4);
assert.equal(result.approvalQueue[0].projectId, "microscopy-foundation-model");
assert.equal(result.approvalQueue[0].severity, "blocked");
assert.equal(result.approvalQueue[0].requestedDecision, "block-and-escalate");
assert.ok(
  result.approvalQueue[0].recommendedActions.includes("attach-restricted-data-compliance-evidence")
);

assert.equal(
  result.apiCatalog.basePath,
  "/enterprise/quota-governance/northbridge-research-university-2026-q2"
);
assert.deepEqual(result.apiCatalog.scopes, [
  "enterprise:quota.read",
  "enterprise:quota.review",
  "enterprise:quota.export"
]);
assert.deepEqual(
  result.apiCatalog.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
  [
    "GET /enterprise/quota-governance/northbridge-research-university-2026-q2/dashboard",
    "GET /enterprise/quota-governance/northbridge-research-university-2026-q2/reviews",
    "GET /enterprise/quota-governance/northbridge-research-university-2026-q2/projects/{projectId}",
    "POST /enterprise/quota-governance/northbridge-research-university-2026-q2/reviews/{queueId}/decision",
    "GET /enterprise/quota-governance/northbridge-research-university-2026-q2/export-manifest"
  ]
);
assert.ok(
  result.apiCatalog.integrationClients.some((client) =>
    client.examples.includes("DSpace")
  )
);
assert.equal(
  result.apiCatalog.endpoints.find((endpoint) => endpoint.response === "exportManifest").recordCount,
  5
);

const climateReview = result.approvalQueue.find(
  (item) => item.projectId === "climate-preprint-replication"
);
assert.equal(climateReview.severity, "critical");
assert.equal(climateReview.requestedDecision, "approve-extension-or-reduce-forecast");

assert.deepEqual(
  result.exportManifest.targets.map((target) => target.system),
  [
    "institutional-admin-dashboard",
    "finance-chargeback-ledger",
    "csv-quota-risk-register",
    "compliance-evidence-archive",
    "workflow-webhooks",
    "enterprise-quota-rest-api"
  ]
);
assert.equal(result.exportManifest.formats.includes("csv"), true);
assert.equal(result.exportRegister.filename, "northbridge-research-university-2026-q2-quota-risk-register.csv");
assert.equal(result.exportRegister.rows.length, 4);
assert.equal(result.exportRegister.rows[0].project_id, "microscopy-foundation-model");
assert.equal(result.exportRegister.rows[0].queue_id, "quota-review-001");
assert.equal(result.exportRegister.rows[0].requested_decision, "block-and-escalate");
assert.equal(result.exportRegister.rows[0].tags, "DOCTORAL-WORK;RESTRICTED-DATA");
assert.equal(
  result.exportRegister.csv.split("\n")[0],
  "project_id,project_title,lab_id,lab_name,department,cost_center,principal_investigator,funder,risk,compute_allocated_gpu_hours,compute_forecast_gpu_hours,compute_overage_gpu_hours,storage_allocated_gb,storage_projected_gb,storage_overage_gb,forecast_cost_usd,tags,queue_id,requested_decision,due_in_days"
);
assert.ok(result.exportRegister.csv.includes("microscopy-foundation-model"));

assert.ok(result.complianceEvidence.customTags.includes("GRANT-TRACKED"));
assert.ok(result.complianceEvidence.customTags.includes("RESTRICTED-DATA"));
assert.ok(
  result.complianceEvidence.requirementMap.some((line) =>
    line.includes("REST API catalog")
  )
);
assert.ok(
  result.complianceEvidence.requirementMap.some((line) =>
    line.includes("Webhook-ready review events")
  )
);

const firstEvent = result.webhookEvents[0];
assert.equal(firstEvent.topic, "enterprise.quota_review_required");
assert.equal(firstEvent.destination, "institutional-admin-api");
assert.equal(
  firstEvent.signature,
  `sha256=${signPayload(firstEvent.payload, sampleData.policy.webhookSecret)}`
);

assert.equal(
  stableStringify({ b: 2, a: [3, { c: "x" }] }),
  '{"a":[3,{"c":"x"}],"b":2}'
);

assert.throws(
  () => evaluateQuotaGovernance({ policy: { warningRatio: 1, criticalRatio: 0.8, blockRatio: 1.1 } }),
  /warning < critical < block/
);

console.log("enterprise-compute-quota-governance tests passed");
