"use strict";

const sampleData = require("./sample-data.json");
const { evaluateQuotaGovernance } = require("./index");

const result = evaluateQuotaGovernance(sampleData);

console.log("Enterprise Compute Quota Governance Demo");
console.log(`Institution: ${result.institution}`);
console.log(`Period: ${result.period}`);
console.log("");
console.log("Portfolio");
console.log(`- Projects: ${result.dashboard.portfolio.projectCount}`);
console.log(`- Forecast GPU hours: ${result.dashboard.portfolio.forecastGpuHours}`);
console.log(`- Projected storage GB: ${result.dashboard.portfolio.projectedStorageGb}`);
console.log(`- Forecast cost USD: ${result.dashboard.portfolio.forecastCostUsd}`);
console.log(`- Risk counts: ${JSON.stringify(result.dashboard.portfolio.riskCounts)}`);
console.log("");
console.log("Top review queue");
for (const item of result.approvalQueue) {
  console.log(
    `- ${item.severity.toUpperCase()} ${item.projectId}: ${item.requestedDecision} (${item.reasons.join("; ")})`
  );
}
console.log("");
console.log("Webhook events");
for (const event of result.webhookEvents) {
  console.log(`- ${event.id} ${event.signature.slice(0, 23)}...`);
}
