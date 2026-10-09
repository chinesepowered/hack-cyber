-- Beagle Brigade schema.
--
-- Table names and the signals/alerts split follow RunReveal's model so the
-- layout is familiar to the ClickHouse team. This is a compatible layout,
-- not an integration with RunReveal.

CREATE DATABASE IF NOT EXISTS beagle;

-- Unified event stream. Every release, finding, signal and verdict lands here.
CREATE TABLE IF NOT EXISTS beagle.logs
(
    receivedAt  DateTime64(3) DEFAULT now64(3),
    eventTime   DateTime64(3),
    sourceType  LowCardinality(String),
    eventName   LowCardinality(String),
    package     String,
    version     String,
    publisher   String,
    ruleId      LowCardinality(String),
    severity    LowCardinality(String),
    file        String,
    line        UInt32,
    score       UInt16,
    rawLog      String,
    INDEX idx_package package TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(eventTime)
ORDER BY (sourceType, eventName, eventTime, package);

-- One row per release we fetched and scanned.
CREATE TABLE IF NOT EXISTS beagle.releases
(
    scannedAt        DateTime64(3) DEFAULT now64(3),
    publishedAt      DateTime64(3),
    ecosystem        LowCardinality(String),
    package          String,
    version          String,
    publisher        String,
    publisherEmail   String,
    repository       String,
    fileCount        UInt32,
    unpackedBytes    UInt64,
    hasInstallScript UInt8,
    score            UInt16,
    verdict          LowCardinality(String),
    ruleIds          Array(LowCardinality(String)),
    signalIds        Array(LowCardinality(String)),
    scanMillis       UInt32,
    latencyMillis    UInt32,
    tarballUrl       String,
    sha256           String,
    INDEX idx_rel_package package TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(scannedAt)
ORDER BY (ecosystem, scannedAt, package);

-- One row per Semgrep finding or heuristic hit.
CREATE TABLE IF NOT EXISTS beagle.findings
(
    scannedAt DateTime64(3) DEFAULT now64(3),
    ecosystem LowCardinality(String),
    package   String,
    version   String,
    ruleId    LowCardinality(String),
    engine    LowCardinality(String),
    severity  LowCardinality(String),
    weight    UInt16,
    file      String,
    line      UInt32,
    endLine   UInt32,
    snippet   String,
    message   String
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(scannedAt)
ORDER BY (ecosystem, package, ruleId);

-- Scored, actionable detections. notificationNames decides signal vs alert.
CREATE TABLE IF NOT EXISTS beagle.detections
(
    detectedAt        DateTime64(3) DEFAULT now64(3),
    ecosystem         LowCardinality(String),
    package           String,
    version           String,
    publisher         String,
    score             UInt16,
    severity          LowCardinality(String),
    verdict           LowCardinality(String),
    ruleIds           Array(LowCardinality(String)),
    signalIds         Array(LowCardinality(String)),
    mitreAttacks      Array(LowCardinality(String)),
    summary           String,
    notificationNames Array(String),
    agentVerdict      String,
    agentActions      Array(String),
    tarballUrl        String
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(detectedAt)
ORDER BY (detectedAt, package);

CREATE VIEW IF NOT EXISTS beagle.signals AS
    SELECT * FROM beagle.detections WHERE empty(notificationNames);

CREATE VIEW IF NOT EXISTS beagle.alerts AS
    SELECT * FROM beagle.detections WHERE notEmpty(notificationNames);

-- Real npm/PyPI registry change history. Backfilled for scale and used for
-- publisher baselines (how often does this publisher normally ship?).
CREATE TABLE IF NOT EXISTS beagle.registry_history
(
    seq        UInt64,
    ecosystem  LowCardinality(String),
    package    String,
    rev        String,
    deleted    UInt8,
    ingestedAt DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (ecosystem, seq);

-- Popular package names, used for typosquat distance.
CREATE TABLE IF NOT EXISTS beagle.top_packages
(
    ecosystem LowCardinality(String),
    package   String,
    rank      UInt32
)
ENGINE = ReplacingMergeTree
ORDER BY (ecosystem, package);

-- Rolling counters the dashboard polls.
CREATE VIEW IF NOT EXISTS beagle.v_today AS
SELECT
    countDistinct(package || '@' || version)                AS releases_scanned,
    countIf(verdict != 'clean')                             AS flagged,
    countIf(verdict = 'malicious')                          AS malicious,
    round(median(latencyMillis) / 1000, 1)                  AS median_latency_s,
    round(quantile(0.95)(latencyMillis) / 1000, 1)          AS p95_latency_s
FROM beagle.releases
WHERE scannedAt >= today();
