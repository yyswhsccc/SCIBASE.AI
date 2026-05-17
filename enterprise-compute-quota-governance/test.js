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
    "compliance-evidence-archive",
    "workflow-webhooks"
  ]
);

assert.ok(result.complianceEvidence.customTags.includes("GRANT-TRACKED"));
assert.ok(result.complianceEvidence.customTags.includes("RESTRICTED-DATA"));
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
