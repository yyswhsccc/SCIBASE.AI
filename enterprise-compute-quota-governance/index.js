"use strict";

const crypto = require("node:crypto");

const DEFAULT_POLICY = Object.freeze({
  warningRatio: 0.8,
  criticalRatio: 1,
  blockRatio: 1.15,
  reviewWindowDays: 7,
  webhookSecret: "synthetic-quota-demo-secret"
});

const RISK_RANK = Object.freeze({
  normal: 0,
  warning: 1,
  critical: 2,
  blocked: 3
});

const EXPORT_REGISTER_HEADERS = Object.freeze([
  "project_id",
  "project_title",
  "lab_id",
  "lab_name",
  "department",
  "cost_center",
  "principal_investigator",
  "funder",
  "risk",
  "compute_allocated_gpu_hours",
  "compute_forecast_gpu_hours",
  "compute_overage_gpu_hours",
  "storage_allocated_gb",
  "storage_projected_gb",
  "storage_overage_gb",
  "forecast_cost_usd",
  "tags",
  "queue_id",
  "requested_decision",
  "due_in_days"
]);

function evaluateQuotaGovernance(input, policyOverrides = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("evaluateQuotaGovernance requires an input object");
  }

  const policy = normalizePolicy(input.policy, policyOverrides);
  const labs = Array.isArray(input.labs) ? input.labs : [];
  const projectEvaluations = labs.flatMap((lab) =>
    (Array.isArray(lab.projects) ? lab.projects : []).map((project) =>
      evaluateProject(lab, project, policy)
    )
  );

  const dashboard = buildDashboard(input, projectEvaluations);
  const approvalQueue = buildApprovalQueue(projectEvaluations, policy);
  const apiCatalog = buildApiCatalog(input, projectEvaluations, dashboard, approvalQueue);
  const exportRegister = buildExportRegister(input, projectEvaluations, approvalQueue);
  const exportManifest = buildExportManifest(
    input,
    projectEvaluations,
    dashboard,
    approvalQueue,
    apiCatalog,
    exportRegister
  );
  const complianceEvidence = buildComplianceEvidence(input, projectEvaluations, dashboard);

  const result = {
    institution: input.institution || "Unknown institution",
    period: input.period || "unspecified",
    generatedAt: input.generatedAt || new Date(0).toISOString(),
    policy: redactPolicy(policy),
    dashboard,
    approvalQueue,
    apiCatalog,
    exportRegister,
    exportManifest,
    complianceEvidence
  };

  result.webhookEvents = buildWebhookEvents(result, policy.webhookSecret);
  return result;
}

function normalizePolicy(...sources) {
  const merged = Object.assign({}, DEFAULT_POLICY, ...sources.filter(Boolean));
  for (const key of ["warningRatio", "criticalRatio", "blockRatio"]) {
    if (!Number.isFinite(merged[key]) || merged[key] <= 0) {
      throw new TypeError(`policy.${key} must be a positive number`);
    }
  }
  if (!(merged.warningRatio < merged.criticalRatio && merged.criticalRatio < merged.blockRatio)) {
    throw new TypeError("policy ratios must be ordered warning < critical < block");
  }
  if (!Number.isInteger(merged.reviewWindowDays) || merged.reviewWindowDays < 1) {
    throw new TypeError("policy.reviewWindowDays must be a positive integer");
  }
  if (!merged.webhookSecret || typeof merged.webhookSecret !== "string") {
    throw new TypeError("policy.webhookSecret must be a non-empty string");
  }
  return merged;
}

function evaluateProject(lab, project, policy) {
  const compute = project.compute || {};
  const storage = project.storage || {};
  const computeForecast = toNumber(compute.usedGpuHours) + toNumber(compute.pendingGpuHours);
  const storageForecast = toNumber(storage.projectedGb, storage.usedGb);
  const computeRatio = quotaRatio(computeForecast, compute.allocatedGpuHours);
  const storageRatio = quotaRatio(storageForecast, storage.allocatedGb);
  const computeRisk = riskFromRatio(computeRatio, policy);
  const storageRisk = riskFromRatio(storageRatio, policy);
  const risk = maxRisk(computeRisk, storageRisk);
  const computeOverage = Math.max(0, computeForecast - toNumber(compute.allocatedGpuHours));
  const storageOverage = Math.max(0, storageForecast - toNumber(storage.allocatedGb));
  const forecastCostUsd =
    computeForecast * toNumber(compute.unitCostUsd) + storageForecast * toNumber(storage.unitCostUsd);

  return {
    projectId: project.id,
    projectTitle: project.title,
    labId: lab.id,
    labName: lab.name,
    department: lab.department,
    costCenter: lab.costCenter,
    principalInvestigator: project.principalInvestigator,
    funder: project.funder,
    tags: Array.isArray(project.tags) ? [...project.tags].sort() : [],
    compute: {
      allocatedGpuHours: toNumber(compute.allocatedGpuHours),
      usedGpuHours: toNumber(compute.usedGpuHours),
      pendingGpuHours: toNumber(compute.pendingGpuHours),
      forecastGpuHours: computeForecast,
      forecastRatio: roundRatio(computeRatio),
      overageGpuHours: round(computeOverage)
    },
    storage: {
      allocatedGb: toNumber(storage.allocatedGb),
      usedGb: toNumber(storage.usedGb),
      projectedGb: storageForecast,
      forecastRatio: roundRatio(storageRatio),
      overageGb: round(storageOverage)
    },
    forecastCostUsd: round(forecastCostUsd),
    risk,
    riskDrivers: riskDrivers(computeRisk, storageRisk, computeOverage, storageOverage),
    recommendedActions: recommendedActions(computeRisk, storageRisk, project)
  };
}

function buildDashboard(input, projectEvaluations) {
  const riskCounts = { normal: 0, warning: 0, critical: 0, blocked: 0 };
  const portfolio = {
    projectCount: projectEvaluations.length,
    allocatedGpuHours: 0,
    forecastGpuHours: 0,
    allocatedStorageGb: 0,
    projectedStorageGb: 0,
    forecastCostUsd: 0,
    riskCounts
  };
  const departments = new Map();

  for (const project of projectEvaluations) {
    riskCounts[project.risk] += 1;
    portfolio.allocatedGpuHours += project.compute.allocatedGpuHours;
    portfolio.forecastGpuHours += project.compute.forecastGpuHours;
    portfolio.allocatedStorageGb += project.storage.allocatedGb;
    portfolio.projectedStorageGb += project.storage.projectedGb;
    portfolio.forecastCostUsd += project.forecastCostUsd;

    const department = departments.get(project.department) || {
      department: project.department,
      projectCount: 0,
      atRiskProjects: 0,
      forecastCostUsd: 0,
      costCenters: []
    };
    department.projectCount += 1;
    department.forecastCostUsd += project.forecastCostUsd;
    if (project.risk !== "normal") {
      department.atRiskProjects += 1;
    }
    if (project.costCenter && !department.costCenters.includes(project.costCenter)) {
      department.costCenters.push(project.costCenter);
    }
    departments.set(project.department, department);
  }

  return {
    institution: input.institution || "Unknown institution",
    period: input.period || "unspecified",
    portfolio: roundDashboard(portfolio),
    departments: [...departments.values()]
      .map((department) => ({
        ...department,
        forecastCostUsd: round(department.forecastCostUsd),
        costCenters: department.costCenters.sort()
      }))
      .sort((a, b) => b.atRiskProjects - a.atRiskProjects || a.department.localeCompare(b.department)),
    topAtRiskProjects: [...projectEvaluations]
      .filter((project) => project.risk !== "normal")
      .sort(compareRisk)
      .slice(0, 5)
      .map((project) => ({
        projectId: project.projectId,
        projectTitle: project.projectTitle,
        labName: project.labName,
        risk: project.risk,
        computeForecastRatio: project.compute.forecastRatio,
        storageForecastRatio: project.storage.forecastRatio,
        recommendedActions: project.recommendedActions
      }))
  };
}

function buildApprovalQueue(projectEvaluations, policy) {
  return [...projectEvaluations]
    .filter((project) => project.risk !== "normal")
    .sort(compareRisk)
    .map((project, index) => ({
      queueId: `quota-review-${String(index + 1).padStart(3, "0")}`,
      projectId: project.projectId,
      projectTitle: project.projectTitle,
      labName: project.labName,
      department: project.department,
      owner: project.principalInvestigator,
      severity: project.risk,
      dueInDays: project.risk === "blocked" ? 1 : policy.reviewWindowDays,
      reasons: project.riskDrivers,
      requestedDecision: decisionForRisk(project.risk),
      recommendedActions: project.recommendedActions
    }));
}

function buildApiCatalog(input, projectEvaluations, dashboard, approvalQueue) {
  const basePath = `/enterprise/quota-governance/${slug([
    input.institution || "institution",
    input.period || "period"
  ])}`;

  return {
    version: "v1",
    basePath,
    authentication: "institutional-service-token",
    scopes: ["enterprise:quota.read", "enterprise:quota.review", "enterprise:quota.export"],
    endpoints: [
      {
        method: "GET",
        path: `${basePath}/dashboard`,
        scope: "enterprise:quota.read",
        description: "Fetch portfolio and department quota metrics for admin dashboards.",
        response: "dashboard",
        recordCount: dashboard.portfolio.projectCount
      },
      {
        method: "GET",
        path: `${basePath}/reviews`,
        scope: "enterprise:quota.review",
        description: "List quota review decisions sorted by blocked, critical, and warning risk.",
        response: "approvalQueue",
        recordCount: approvalQueue.length
      },
      {
        method: "GET",
        path: `${basePath}/projects/{projectId}`,
        scope: "enterprise:quota.read",
        description: "Inspect a project compute/storage forecast, chargeback cost, and actions.",
        response: "projectEvaluation",
        recordCount: projectEvaluations.length
      },
      {
        method: "POST",
        path: `${basePath}/reviews/{queueId}/decision`,
        scope: "enterprise:quota.review",
        description: "Submit an admin approval, reduction, or escalation decision.",
        response: "decisionReceipt",
        recordCount: approvalQueue.length
      },
      {
        method: "GET",
        path: `${basePath}/export-manifest`,
        scope: "enterprise:quota.export",
        description: "Fetch routing metadata for dashboards, finance, compliance, and webhooks.",
        response: "exportManifest",
        recordCount: 5
      }
    ],
    integrationClients: [
      {
        system: "institutional repositories",
        examples: ["DSpace", "Invenio"],
        uses: ["compliance evidence archive", "quota-aware export routing"]
      },
      {
        system: "research operations dashboards",
        examples: ["department admin console", "research office portal"],
        uses: ["portfolio usage visibility", "approval queue triage"]
      },
      {
        system: "finance and chargeback ledgers",
        examples: ["ERP cost centers", "grant accounting"],
        uses: ["forecast cost allocation", "department-level budget review"]
      },
      {
        system: "workflow automation",
        examples: ["webhook receivers", "ticketing systems"],
        uses: ["review-required notifications", "decision receipt tracking"]
      }
    ]
  };
}

function buildExportRegister(input, projectEvaluations, approvalQueue) {
  const reviewByProject = new Map(approvalQueue.map((review) => [review.projectId, review]));
  const rows = [...projectEvaluations].sort(compareRisk).map((project) => {
    const review = reviewByProject.get(project.projectId);
    return {
      project_id: project.projectId,
      project_title: project.projectTitle,
      lab_id: project.labId,
      lab_name: project.labName,
      department: project.department,
      cost_center: project.costCenter || "",
      principal_investigator: project.principalInvestigator || "",
      funder: project.funder || "",
      risk: project.risk,
      compute_allocated_gpu_hours: project.compute.allocatedGpuHours,
      compute_forecast_gpu_hours: project.compute.forecastGpuHours,
      compute_overage_gpu_hours: project.compute.overageGpuHours,
      storage_allocated_gb: project.storage.allocatedGb,
      storage_projected_gb: project.storage.projectedGb,
      storage_overage_gb: project.storage.overageGb,
      forecast_cost_usd: project.forecastCostUsd,
      tags: project.tags.join(";"),
      queue_id: review ? review.queueId : "",
      requested_decision: review ? review.requestedDecision : "",
      due_in_days: review ? review.dueInDays : ""
    };
  });

  return {
    filename: `${slug([
      input.institution || "institution",
      input.period || "period",
      "quota-risk-register"
    ])}.csv`,
    headers: [...EXPORT_REGISTER_HEADERS],
    rows,
    csv: rowsToCsv(EXPORT_REGISTER_HEADERS, rows)
  };
}

function rowsToCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join(
    "\n"
  );
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildExportManifest(input, projectEvaluations, dashboard, approvalQueue, apiCatalog, exportRegister) {
  const atRiskProjects = projectEvaluations.filter((project) => project.risk !== "normal");
  return {
    manifestId: slug([input.institution || "institution", input.period || "period", "quota-governance"]),
    generatedAt: input.generatedAt || new Date(0).toISOString(),
    formats: ["json", "csv"],
    targets: [
      {
        system: "institutional-admin-dashboard",
        payload: "portfolio quota summary, department chargeback, top risk queue",
        recordCount: dashboard.portfolio.projectCount
      },
      {
        system: "finance-chargeback-ledger",
        payload: "cost center usage forecast with compute and storage units",
        recordCount: dashboard.departments.length
      },
      {
        system: "csv-quota-risk-register",
        payload: `${exportRegister.filename} with project, lab, quota, risk, queue, and decision columns`,
        recordCount: exportRegister.rows.length
      },
      {
        system: "compliance-evidence-archive",
        payload: "review decisions, custom tags, funder-linked quota actions",
        recordCount: atRiskProjects.length
      },
      {
        system: "workflow-webhooks",
        payload: "quota review required events for restricted or over-quota projects",
        recordCount: approvalQueue.length
      },
      {
        system: "enterprise-quota-rest-api",
        payload: "endpoint catalog for dashboards, review queues, project detail, decisions, and export manifests",
        recordCount: apiCatalog.endpoints.length
      }
    ]
  };
}

function buildComplianceEvidence(input, projectEvaluations, dashboard) {
  const flaggedTags = [...new Set(projectEvaluations.flatMap((project) => project.tags))].sort();
  return {
    requirementMap: [
      "Organization-wide admin dashboard for projects, departments, cost centers, and risk queue",
      "Usage stats for compute, storage, pending jobs, forecast overage, and chargeback",
      "Custom tags retained for grant, doctoral, restricted-data, and open-science initiatives",
      "REST API catalog for dashboard, review queue, project detail, decision, and export routes",
      "Webhook-ready review events with deterministic HMAC signatures",
      "Export manifest for institutional dashboards, finance ledgers, and compliance archives"
    ],
    customTags: flaggedTags,
    fundersRepresented: [...new Set(projectEvaluations.map((project) => project.funder).filter(Boolean))].sort(),
    reviewSummary: {
      generatedAt: input.generatedAt || new Date(0).toISOString(),
      riskCounts: dashboard.portfolio.riskCounts,
      atRiskProjectCount: projectEvaluations.filter((project) => project.risk !== "normal").length
    }
  };
}

function buildWebhookEvents(result, secret) {
  return result.approvalQueue.map((item) => {
    const payload = {
      eventType: "enterprise.quota_review_required",
      institution: result.institution,
      period: result.period,
      queueId: item.queueId,
      projectId: item.projectId,
      severity: item.severity,
      requestedDecision: item.requestedDecision,
      dueInDays: item.dueInDays
    };
    return {
      id: `${payload.eventType}.${item.queueId}`,
      topic: payload.eventType,
      destination: "institutional-admin-api",
      payload,
      signature: `sha256=${signPayload(payload, secret)}`
    };
  });
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(stableStringify(payload)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function quotaRatio(forecast, allocated) {
  const allocatedNumber = toNumber(allocated);
  if (allocatedNumber <= 0) {
    return forecast > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return forecast / allocatedNumber;
}

function riskFromRatio(value, policy) {
  if (value >= policy.blockRatio) {
    return "blocked";
  }
  if (value >= policy.criticalRatio) {
    return "critical";
  }
  if (value >= policy.warningRatio) {
    return "warning";
  }
  return "normal";
}

function maxRisk(...risks) {
  return risks.sort((a, b) => RISK_RANK[b] - RISK_RANK[a])[0];
}

function riskDrivers(computeRisk, storageRisk, computeOverage, storageOverage) {
  const drivers = [];
  if (computeRisk !== "normal") {
    drivers.push(
      computeOverage > 0
        ? `compute forecast exceeds allocation by ${round(computeOverage)} GPU hours`
        : `compute forecast is in ${computeRisk} band`
    );
  }
  if (storageRisk !== "normal") {
    drivers.push(
      storageOverage > 0
        ? `storage forecast exceeds allocation by ${round(storageOverage)} GB`
        : `storage forecast is in ${storageRisk} band`
    );
  }
  return drivers;
}

function recommendedActions(computeRisk, storageRisk, project) {
  const actions = new Set();
  const projectTags = Array.isArray(project.tags) ? project.tags : [];
  const overallRisk = maxRisk(computeRisk, storageRisk);

  if (overallRisk === "blocked") {
    actions.add("pause-new-workloads-until-admin-review");
    actions.add("route-to-department-head");
  } else if (overallRisk === "critical") {
    actions.add("require-quota-extension-approval");
  } else if (overallRisk === "warning") {
    actions.add("notify-lab-owner-before-next-billing-cycle");
  }

  if (storageRisk !== "normal") {
    actions.add("review-cold-storage-and-export-archive-options");
  }
  if (computeRisk !== "normal") {
    actions.add("cap-pending-gpu-jobs-until-approval");
  }
  if (projectTags.includes("RESTRICTED-DATA")) {
    actions.add("attach-restricted-data-compliance-evidence");
  }
  if (projectTags.includes("GRANT-TRACKED")) {
    actions.add("preserve-funder-mandate-audit-trail");
  }

  return [...actions].sort();
}

function decisionForRisk(risk) {
  if (risk === "blocked") {
    return "block-and-escalate";
  }
  if (risk === "critical") {
    return "approve-extension-or-reduce-forecast";
  }
  return "review-before-next-allocation-cycle";
}

function compareRisk(a, b) {
  return (
    RISK_RANK[b.risk] - RISK_RANK[a.risk] ||
    b.forecastCostUsd - a.forecastCostUsd ||
    a.projectId.localeCompare(b.projectId)
  );
}

function roundDashboard(portfolio) {
  return {
    ...portfolio,
    allocatedGpuHours: round(portfolio.allocatedGpuHours),
    forecastGpuHours: round(portfolio.forecastGpuHours),
    allocatedStorageGb: round(portfolio.allocatedStorageGb),
    projectedStorageGb: round(portfolio.projectedStorageGb),
    forecastCostUsd: round(portfolio.forecastCostUsd)
  };
}

function redactPolicy(policy) {
  const copy = { ...policy };
  copy.webhookSecret = "<redacted>";
  return copy;
}

function toNumber(value, fallback = 0) {
  const candidate = value ?? fallback;
  return Number.isFinite(Number(candidate)) ? Number(candidate) : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.round(value * 1000) / 1000;
}

function slug(parts) {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

module.exports = {
  DEFAULT_POLICY,
  evaluateQuotaGovernance,
  signPayload,
  stableStringify
};
