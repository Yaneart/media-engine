export const SMOKE_CLASSIFICATION = Object.freeze({
  healthy: "HEALTHY",
  upstreamDegraded: "UPSTREAM_DEGRADED",
  budgetExceeded: "BUDGET_EXCEEDED",
  contractRegression: "CONTRACT_REGRESSION",
});

const knownStatuses = new Set(["PASS", "WARN", "FAIL"]);
const knownClassifications = new Set(Object.values(SMOKE_CLASSIFICATION));

export function readSmokePolicy(argv = process.argv.slice(2)) {
  const failOnWarn = argv.includes("--strict") || argv.includes("--fail-on-warn");
  const configuredMaxWarnings = readNonNegativeIntegerOption(argv, "--max-warnings");

  return {
    json: argv.includes("--json"),
    maxWarnings: failOnWarn ? 0 : (configuredMaxWarnings ?? Number.POSITIVE_INFINITY),
  };
}

export function createSmokeReport({ smoke, results, policy, metadata = {} }) {
  if (!smoke || typeof smoke !== "string") {
    throw new TypeError("Smoke report name must be a non-empty string.");
  }

  const normalizedResults = results.map(normalizeResult);
  const pass = normalizedResults.filter((result) => result.status === "PASS").length;
  const warn = normalizedResults.filter((result) => result.status === "WARN").length;
  const fail = normalizedResults.filter((result) => result.status === "FAIL").length;
  const classifications = Object.fromEntries(
    Object.values(SMOKE_CLASSIFICATION).map((classification) => [
      classification,
      normalizedResults.filter((result) => result.classification === classification).length,
    ]),
  );
  const warningBudgetExceeded = warn > policy.maxWarnings;
  const exitCode = fail > 0 || warningBudgetExceeded ? 1 : 0;

  return {
    schemaVersion: 1,
    smoke,
    ...metadata,
    policy: {
      contractRegressionsFail: true,
      maxWarnings: Number.isFinite(policy.maxWarnings) ? policy.maxWarnings : null,
    },
    results: normalizedResults,
    summary: {
      total: normalizedResults.length,
      pass,
      warn,
      fail,
      classifications,
      warningBudgetExceeded,
      exitCode,
    },
  };
}

export function applySmokeExitCode(report) {
  if (report.summary.exitCode !== 0) {
    process.exitCode = report.summary.exitCode;
  }
}

export function formatSmokePolicy(report) {
  const maximum = report.policy.maxWarnings;
  const warningPolicy =
    maximum === null ? "warnings are reported but do not fail" : `maximum warnings: ${maximum}`;

  return `Exit policy: any CONTRACT_REGRESSION fails; ${warningPolicy}.`;
}

export function classifySmokeError(error) {
  if (
    error &&
    typeof error === "object" &&
    (error.name === "ProviderError" ||
      (error.name === "MediaEngineError" && error.code === "PROVIDER_ERROR"))
  ) {
    return classifySmokeOutcome({ upstreamDegraded: true });
  }

  return classifySmokeOutcome({ contractRegression: true });
}

export function classifySmokeOutcome({
  contractRegression = false,
  upstreamDegraded = false,
  budgetExceeded = false,
} = {}) {
  if (contractRegression) {
    return {
      status: "FAIL",
      classification: SMOKE_CLASSIFICATION.contractRegression,
    };
  }

  if (upstreamDegraded) {
    return {
      status: "WARN",
      classification: SMOKE_CLASSIFICATION.upstreamDegraded,
    };
  }

  if (budgetExceeded) {
    return {
      status: "WARN",
      classification: SMOKE_CLASSIFICATION.budgetExceeded,
    };
  }

  return {
    status: "PASS",
    classification: SMOKE_CLASSIFICATION.healthy,
  };
}

function normalizeResult(result) {
  if (!knownStatuses.has(result.status)) {
    throw new TypeError(`Unknown smoke status ${JSON.stringify(result.status)}.`);
  }

  const classification = result.classification ?? defaultClassification(result.status);

  if (!knownClassifications.has(classification)) {
    throw new TypeError(`Unknown smoke classification ${JSON.stringify(classification)}.`);
  }

  if (result.status === "PASS" && classification !== SMOKE_CLASSIFICATION.healthy) {
    throw new TypeError("PASS smoke results must use the HEALTHY classification.");
  }

  if (result.status === "FAIL" && classification !== SMOKE_CLASSIFICATION.contractRegression) {
    throw new TypeError("FAIL smoke results must use the CONTRACT_REGRESSION classification.");
  }

  if (result.status === "WARN" && classification === SMOKE_CLASSIFICATION.healthy) {
    throw new TypeError("WARN smoke results cannot use the HEALTHY classification.");
  }

  return { ...result, classification };
}

function defaultClassification(status) {
  if (status === "PASS") {
    return SMOKE_CLASSIFICATION.healthy;
  }

  if (status === "WARN") {
    return SMOKE_CLASSIFICATION.upstreamDegraded;
  }

  return SMOKE_CLASSIFICATION.contractRegression;
}

function readNonNegativeIntegerOption(argv, name) {
  const indexes = argv.flatMap((value, index) => (value === name ? [index] : []));

  if (indexes.length === 0) {
    return undefined;
  }

  if (indexes.length > 1) {
    throw new TypeError(`${name} may be provided only once.`);
  }

  const rawValue = argv[indexes[0] + 1];

  if (rawValue === undefined || rawValue.startsWith("--")) {
    throw new TypeError(`${name} requires a non-negative integer.`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} requires a non-negative safe integer.`);
  }

  return value;
}
