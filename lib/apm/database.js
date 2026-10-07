'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MONTHLY_REQUEST_LIMIT = 100000;
const PROVIDERS = new Set(['generic', 'aws', 'gcp', 'vercel', 'kubernetes']);
const RESOURCE_TYPES = new Set([
  'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
  'gcp-cloud-run', 'gcp-function', 'vercel-project', 's3', 'sns', 'dynamodb',
  'ec2', 'eks', 'rds', 'apigateway', 'cloudfront', 'autoscaling', 'elasticache',
]);
const DEFAULT_THRESHOLDS = Object.freeze({
  errorRatePercent: 5,
  durationMs: 1000,
  readyPodsPercent: 100,
  restartDelta: 1,
  recurringSignatureGrowthPercent: 100,
});
const THRESHOLD_KEYS = new Set(Object.keys(DEFAULT_THRESHOLDS));

function checkApplicationRevision(application, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null || expectedRevision === '') return;
  if (Number(expectedRevision) !== application.revision) {
    throw Object.assign(new Error('The application changed since it was read'), {
      statusCode: 409,
      code: 'REVISION_CONFLICT',
      revision: application.revision,
    });
  }
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE apm_applications (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        region TEXT NOT NULL,
        name TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT '',
        team TEXT NOT NULL DEFAULT '',
        polling_enabled INTEGER NOT NULL DEFAULT 0 CHECK (polling_enabled IN (0, 1)),
        poll_interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (poll_interval_minutes = 30),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (profile_id, region, name, environment)
      );

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('lambda', 'kubernetes')),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      CREATE TABLE apm_edges (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        source_resource_id TEXT NOT NULL REFERENCES apm_resources(id) ON DELETE CASCADE,
        target_resource_id TEXT NOT NULL REFERENCES apm_resources(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL DEFAULT 'depends_on',
        confirmed INTEGER NOT NULL DEFAULT 1 CHECK (confirmed = 1),
        created_at TEXT NOT NULL,
        UNIQUE (source_resource_id, target_resource_id, relation_type),
        CHECK (source_resource_id <> target_resource_id)
      );

      CREATE TABLE apm_metric_buckets (
        resource_id TEXT NOT NULL REFERENCES apm_resources(id) ON DELETE CASCADE,
        bucket_start INTEGER NOT NULL,
        metric_name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'count',
        sample_count INTEGER NOT NULL DEFAULT 0,
        value_sum REAL NOT NULL DEFAULT 0,
        value_min REAL,
        value_max REAL,
        value_last REAL,
        source TEXT NOT NULL,
        quality TEXT NOT NULL DEFAULT 'full' CHECK (quality IN ('full', 'partial')),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (resource_id, bucket_start, metric_name, source)
      );

      CREATE TABLE apm_collection_cursors (
        resource_id TEXT NOT NULL REFERENCES apm_resources(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        cursor_timestamp INTEGER,
        next_token TEXT,
        boundary_hashes_json TEXT NOT NULL DEFAULT '[]',
        state_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (resource_id, source)
      );

      CREATE TABLE apm_collection_runs (
        id TEXT PRIMARY KEY,
        application_id TEXT REFERENCES apm_applications(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        region TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'opportunistic')),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'budget_exhausted')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        request_count INTEGER NOT NULL DEFAULT 0,
        backlog INTEGER NOT NULL DEFAULT 0 CHECK (backlog IN (0, 1)),
        error_code TEXT,
        error_message TEXT
      );

      CREATE TABLE apm_api_usage (
        profile_id TEXT NOT NULL,
        region TEXT NOT NULL,
        month_utc TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, region, month_utc, operation)
      );

      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      CREATE INDEX idx_apm_metrics_time ON apm_metric_buckets(bucket_start);
      CREATE INDEX idx_apm_metrics_resource_time ON apm_metric_buckets(resource_id, metric_name, bucket_start);
      CREATE INDEX idx_apm_runs_profile_time ON apm_collection_runs(profile_id, region, started_at);
    `,
  },
  {
    version: 2,
    sql: `ALTER TABLE apm_applications ADD COLUMN thresholds_json TEXT NOT NULL DEFAULT '{}';`,
  },
  {
    version: 3,
    sql: `UPDATE apm_resources SET metadata_json = '{}';`,
  },
  {
    version: 4,
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_resources RENAME TO apm_resources_v3;

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs')),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels', 'deployment')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      INSERT INTO apm_resources (
        id, application_id, resource_type, resource_key, arn, kube_context, namespace,
        kind, name, service, log_group, metadata_json, association_source, enabled,
        created_at, updated_at
      ) SELECT
        id, application_id, resource_type, resource_key, arn, kube_context, namespace,
        kind, name, service, log_group, '{}', association_source, enabled,
        created_at, updated_at
      FROM apm_resources_v3;

      DROP TABLE apm_resources_v3;
      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 5,
    foreignKeysOff: true,
    sql: `
      ALTER TABLE apm_applications ADD COLUMN provider TEXT NOT NULL DEFAULT 'aws';
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_resources RENAME TO apm_resources_v4;

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('aws', 'gcp', 'vercel')),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
          'gcp-cloud-run', 'gcp-function', 'vercel-project'
        )),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels', 'deployment')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      INSERT INTO apm_resources (
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      ) SELECT
        id, application_id, 'aws', resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      FROM apm_resources_v4;

      DROP TABLE apm_resources_v4;
      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 6,
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_resources RENAME TO apm_resources_v5;

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('generic', 'aws', 'gcp', 'vercel')),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
          'gcp-cloud-run', 'gcp-function', 'vercel-project'
        )),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels', 'deployment')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      INSERT INTO apm_resources (
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      ) SELECT
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      FROM apm_resources_v5;
      DROP TABLE apm_resources_v5;
      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE apm_applications ADD COLUMN architecture_project_id TEXT;
      CREATE INDEX idx_apm_applications_architecture_project
        ON apm_applications(architecture_project_id);
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE kua_registry_resources (
        id TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        native_identifier TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        lineage_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE kua_registry_memberships (
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES kua_registry_resources(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL,
        source_reference TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (application_id, resource_id, source_kind, source_reference)
      );

      CREATE TABLE kua_registry_relationships (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        source_resource_id TEXT NOT NULL REFERENCES kua_registry_resources(id) ON DELETE CASCADE,
        target_resource_id TEXT NOT NULL REFERENCES kua_registry_resources(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, source_resource_id, target_resource_id, relation_type),
        CHECK (source_resource_id <> target_resource_id)
      );

      CREATE INDEX idx_kua_registry_memberships_application
        ON kua_registry_memberships(application_id, resource_id);
      CREATE INDEX idx_kua_registry_relationships_application
        ON kua_registry_relationships(application_id, source_resource_id, target_resource_id);
    `,
  },
  {
    version: 9,
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_resources RENAME TO apm_resources_v8;

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('generic', 'aws', 'gcp', 'vercel')),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
          'gcp-cloud-run', 'gcp-function', 'vercel-project'
        )),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels', 'deployment', 'architecture')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      INSERT INTO apm_resources (
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      ) SELECT
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      FROM apm_resources_v8;
      DROP TABLE apm_resources_v8;
      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 10,
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_resources RENAME TO apm_resources_v9;

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('generic', 'aws', 'gcp', 'vercel', 'kubernetes')),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
          'gcp-cloud-run', 'gcp-function', 'vercel-project'
        )),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels', 'deployment', 'architecture')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      INSERT INTO apm_resources (
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      ) SELECT
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      FROM apm_resources_v9;
      DROP TABLE apm_resources_v9;
      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 11,
    sql: `
      CREATE TABLE kua_registry_sync_status (
        application_id TEXT PRIMARY KEY REFERENCES apm_applications(id) ON DELETE CASCADE,
        last_success_at TEXT,
        last_error TEXT,
        last_error_at TEXT,
        last_duration_ms INTEGER,
        divergent_resource_count INTEGER NOT NULL DEFAULT 0,
        divergent_relationship_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 12,
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_resources RENAME TO apm_resources_v10;

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('generic', 'aws', 'gcp', 'vercel', 'kubernetes')),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
          'gcp-cloud-run', 'gcp-function', 'vercel-project', 's3', 'sns', 'dynamodb'
        )),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels', 'deployment', 'architecture')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      INSERT INTO apm_resources (
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      ) SELECT
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      FROM apm_resources_v10;
      DROP TABLE apm_resources_v10;
      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 13,
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_resources RENAME TO apm_resources_v12;

      CREATE TABLE apm_resources (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('generic', 'aws', 'gcp', 'vercel', 'kubernetes')),
        resource_type TEXT NOT NULL CHECK (resource_type IN (
          'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
          'gcp-cloud-run', 'gcp-function', 'vercel-project', 's3', 'sns', 'dynamodb',
          'ec2', 'eks', 'rds', 'apigateway', 'cloudfront', 'autoscaling', 'elasticache'
        )),
        resource_key TEXT NOT NULL,
        arn TEXT,
        kube_context TEXT,
        namespace TEXT,
        kind TEXT,
        name TEXT NOT NULL,
        service TEXT NOT NULL DEFAULT '',
        log_group TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        association_source TEXT NOT NULL CHECK (association_source IN ('manual', 'tags', 'labels', 'deployment', 'architecture')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (application_id, resource_type, resource_key)
      );

      INSERT INTO apm_resources (
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      ) SELECT
        id, application_id, provider, resource_type, resource_key, arn, kube_context,
        namespace, kind, name, service, log_group, metadata_json, association_source,
        enabled, created_at, updated_at
      FROM apm_resources_v12;
      DROP TABLE apm_resources_v12;
      CREATE INDEX idx_apm_resources_application ON apm_resources(application_id, enabled);
      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE apm_application_architecture_projects (
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (application_id, project_id)
      );

      CREATE INDEX idx_apm_application_architecture_projects_application
        ON apm_application_architecture_projects(application_id, updated_at DESC);
      CREATE INDEX idx_apm_application_architecture_projects_project
        ON apm_application_architecture_projects(project_id, updated_at DESC);

      INSERT INTO apm_application_architecture_projects (application_id, project_id, created_at, updated_at)
      SELECT id, architecture_project_id, created_at, updated_at
      FROM apm_applications
      WHERE architecture_project_id IS NOT NULL AND architecture_project_id <> '';
    `,
  },
  {
    // Resource state history for cloud observability (see lib/stateHistory.js)
    version: 15,
    sql: `
      CREATE TABLE kua_resource_state_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        project TEXT,
        resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        resource_name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('state', 'action')),
        source TEXT NOT NULL CHECK (source IN ('observed', 'poll', 'user')),
        state TEXT,
        previous_state TEXT,
        action TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        observed_at TEXT NOT NULL
      );
      CREATE INDEX idx_kua_state_events_resource
        ON kua_resource_state_events(provider, profile_id, resource_type, resource_key, observed_at DESC);
      CREATE INDEX idx_kua_state_events_time ON kua_resource_state_events(observed_at);

      CREATE TABLE kua_resource_last_state (
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        resource_name TEXT NOT NULL,
        state TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (provider, profile_id, resource_type, resource_key)
      );

      CREATE TABLE kua_state_poll_settings (
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        interval_minutes INTEGER NOT NULL DEFAULT 15,
        resource_types_json TEXT NOT NULL DEFAULT '[]',
        retention_days INTEGER NOT NULL DEFAULT 90,
        last_run_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, profile_id)
      );
    `,
  },
  {
    // Metric history for cloud views (see lib/metricHistory.js). Resources use the
    // same identities as the KUA registry (e.g. AWS::SQS::Queue:orders).
    version: 16,
    sql: `
      CREATE TABLE kua_metric_points (
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT '',
        resource_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        period_s INTEGER NOT NULL,
        bucket_start INTEGER NOT NULL,
        value REAL NOT NULL,
        PRIMARY KEY (provider, profile_id, region, resource_id, metric, period_s, bucket_start)
      );
      CREATE INDEX idx_kua_metric_points_time ON kua_metric_points(bucket_start);

      -- Which window of each series was read and when: an hour without points
      -- inside a covered window means "no data", not "not fetched".
      CREATE TABLE kua_metric_coverage (
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT '',
        resource_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        period_s INTEGER NOT NULL,
        covered_from INTEGER NOT NULL,
        covered_to INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (provider, profile_id, region, resource_id, metric, period_s)
      );
    `,
  },
  {
    // JSON snapshots for provider responses, logs and overview history (see
    // lib/cloudHistory.js). Cache expiry is deliberately separate from history
    // retention so an expired cache entry can still be used for trends.
    version: 17,
    sql: `
      CREATE TABLE kua_cloud_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT '',
        resource_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (provider, profile_id, region, resource_key, kind, captured_at, content_hash)
      );
      CREATE INDEX idx_kua_cloud_documents_latest
        ON kua_cloud_documents(provider, profile_id, region, resource_key, kind, captured_at DESC);
      CREATE INDEX idx_kua_cloud_documents_retention
        ON kua_cloud_documents(captured_at);
    `,
  },
  {
    // Advisor posture (lib/advisor/posture.js): findings a team accepted or
    // silenced, and one summary per analysis to show how the posture evolves.
    // History has its own retention: kua_cloud_documents keeps days, posture
    // trends need months.
    version: 18,
    sql: `
      CREATE TABLE kua_advisor_acceptances (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        resource_key TEXT,
        resource_label TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('accepted', 'silenced')),
        reason TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT 'local',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        revoked_by TEXT
      );
      CREATE INDEX idx_kua_advisor_acceptances_scope
        ON kua_advisor_acceptances(scope_key, rule_id);
      CREATE TABLE kua_advisor_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_key TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
      CREATE INDEX idx_kua_advisor_history_scope
        ON kua_advisor_history(scope_key, captured_at DESC);
    `,
  },
  {
    // Posture alerts (lib/advisor/posture.js): what changed between two
    // analyses, and acceptances about to expire. dedupe_key keeps one alert
    // per change and day.
    version: 19,
    sql: `
      CREATE TABLE kua_advisor_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        scope_key TEXT NOT NULL,
        type TEXT NOT NULL,
        rule_id TEXT,
        severity TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        read_at INTEGER
      );
      CREATE INDEX idx_kua_advisor_alerts_created
        ON kua_advisor_alerts(created_at DESC);
    `,
  },
  {
    // Scheduled Advisor analysis (lib/advisor/scheduler.js): one row per
    // history scope the user asked KUA to analyse on its own.
    version: 20,
    sql: `
      CREATE TABLE kua_advisor_schedules (
        scope_key TEXT PRIMARY KEY,
        interval_hours INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_run_at INTEGER,
        last_status TEXT,
        last_error TEXT
      );
    `,
  },
  {
    // KUA Application contract (#149, lib/kua/applicationContract.js): an application no longer
    // needs a provider, profile or region of its own, and its name is not an identity. Its
    // provider scopes are portable; the profile bound to each scope is local to this computer
    // and must never be exported, synced or uploaded.
    version: 21,
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE apm_applications RENAME TO apm_applications_v20;

      CREATE TABLE apm_applications (
        id TEXT PRIMARY KEY,
        provider TEXT,
        profile_id TEXT,
        region TEXT,
        name TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT '',
        team TEXT NOT NULL DEFAULT '',
        polling_enabled INTEGER NOT NULL DEFAULT 0 CHECK (polling_enabled IN (0, 1)),
        poll_interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (poll_interval_minutes = 30),
        thresholds_json TEXT NOT NULL DEFAULT '{}',
        architecture_project_id TEXT,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO apm_applications (
        id, provider, profile_id, region, name, environment, team, polling_enabled,
        poll_interval_minutes, thresholds_json, architecture_project_id, revision, created_at, updated_at
      ) SELECT
        id, provider, profile_id, region, name, environment, team, polling_enabled,
        poll_interval_minutes, thresholds_json, architecture_project_id, 0, created_at, updated_at
      FROM apm_applications_v20;
      DROP TABLE apm_applications_v20;
      CREATE INDEX idx_apm_applications_architecture_project ON apm_applications(architecture_project_id);
      CREATE INDEX idx_apm_applications_profile ON apm_applications(profile_id, region);
      PRAGMA legacy_alter_table = OFF;

      CREATE TABLE kua_application_scopes (
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        scope_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (application_id, scope_key)
      );

      CREATE TABLE kua_scope_bindings (
        application_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('migrated', 'unverified', 'verified', 'mismatch')),
        verified_identity TEXT,
        verified_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (application_id, scope_key),
        FOREIGN KEY (application_id, scope_key)
          REFERENCES kua_application_scopes(application_id, scope_key) ON DELETE CASCADE
      );

      -- Local registry resources that identity v2 merges into one (same resource seen
      -- through several profiles). Kept so the migration report can show them later.
      CREATE TABLE kua_registry_identity_merges (
        identity_key TEXT PRIMARY KEY,
        merged_count INTEGER NOT NULL,
        application_ids_json TEXT NOT NULL DEFAULT '[]',
        detected_at TEXT NOT NULL
      );
    `,
  },
  {
    // A detached resource can remain visible in an Architecture view without remaining a
    // member of its KUA Application. The portable identity keeps reconcile from reattaching it.
    version: 22,
    sql: `
      CREATE TABLE kua_registry_detachments (
        application_id TEXT NOT NULL REFERENCES apm_applications(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL,
        identity_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (application_id, resource_id)
      );
      CREATE INDEX idx_kua_registry_detachments_identity
        ON kua_registry_detachments(application_id, identity_key);
    `,
  },
  {
    // The account and region a resource lives in when its identifiers do not say it (resources
    // discovered from CloudFormation have no ARN). Without them an application without provider
    // cannot pick the region to collect in, and the registry splits one resource in two (#166).
    version: 23,
    sql: `
      ALTER TABLE apm_resources ADD COLUMN scope_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE apm_resources ADD COLUMN location TEXT NOT NULL DEFAULT '';
    `,
  },
];

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

function monthUtc(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function toBoolean(value) {
  return value ? 1 : 0;
}

function normalizeThresholds(changes = {}, current = DEFAULT_THRESHOLDS) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw Object.assign(new Error('Thresholds must be an object'), { statusCode: 400 });
  }
  const thresholds = { ...DEFAULT_THRESHOLDS, ...current };
  for (const [key, rawValue] of Object.entries(changes)) {
    if (!THRESHOLD_KEYS.has(key)) {
      throw Object.assign(new Error(`Unsupported threshold: ${key}`), { statusCode: 400 });
    }
    if (rawValue === null) {
      thresholds[key] = null;
      continue;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0
      || (key === 'recurringSignatureGrowthPercent' && value > 1000)
      || (key.endsWith('Percent') && key !== 'recurringSignatureGrowthPercent' && value > 100)) {
      throw Object.assign(new Error(`Invalid threshold value: ${key}`), { statusCode: 400 });
    }
    thresholds[key] = value;
  }
  return thresholds;
}

class ApmDatabase {
  // schemaVersion stops migrations at an older version; only tests use it, to upgrade real data.
  constructor({ filePath, now = () => Date.now(), schemaVersion = SCHEMA_VERSION } = {}) {
    this.now = now;
    this.filePath = filePath || path.join(resolveDataDir(), 'apm-observability.sqlite3');
    this._ensureStorage();
    this.db = new Database(this.filePath);
    if (this.filePath !== ':memory:') {
      try { fs.chmodSync(this.filePath, 0o600); } catch (_) {}
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('auto_vacuum = INCREMENTAL');
    this._migrate(schemaVersion);
    if (schemaVersion === SCHEMA_VERSION) this._prepare();
  }

  _ensureStorage() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch (_) {}
  }

  _migrate(targetVersion = SCHEMA_VERSION) {
    const currentVersion = this.db.pragma('user_version', { simple: true });
    this.migratedFrom = currentVersion;
    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      if (migration.version > targetVersion) break;
      if (migration.foreignKeysOff) this.db.pragma('foreign_keys = OFF');
      try {
        this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db.pragma(`user_version = ${migration.version}`);
        })();
      } finally {
        if (migration.foreignKeysOff) this.db.pragma('foreign_keys = ON');
      }
    }
    const violations = this.db.pragma('foreign_key_check');
    if (violations.length) throw new Error('APM database migration produced invalid references');
  }

  _prepare() {
    this.statements = {
      applicationById: this.db.prepare('SELECT * FROM apm_applications WHERE id = ?'),
      resourceById: this.db.prepare('SELECT * FROM apm_resources WHERE id = ?'),
      cursor: this.db.prepare('SELECT * FROM apm_collection_cursors WHERE resource_id = ? AND source = ?'),
      apiUsageTotal: this.db.prepare(`
        SELECT COALESCE(SUM(request_count), 0) AS total
        FROM apm_api_usage
        WHERE profile_id = ? AND month_utc = ?
      `),
    };

    this.reserveApiRequests = this.db.transaction((profileId, region, operation, count, limit, timestamp) => {
      const month = monthUtc(timestamp);
      const used = this.statements.apiUsageTotal.get(profileId, month).total;
      if (used + count > limit) {
        return { allowed: false, used, requested: count, limit, remaining: Math.max(0, limit - used), month };
      }
      const updatedAt = new Date(timestamp).toISOString();
      this.db.prepare(`
        INSERT INTO apm_api_usage (profile_id, region, month_utc, operation, request_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile_id, region, month_utc, operation) DO UPDATE SET
          request_count = request_count + excluded.request_count,
          updated_at = excluded.updated_at
      `).run(profileId, region, month, operation, count, updatedAt);
      const total = used + count;
      return {
        allowed: true,
        used: total,
        requested: count,
        limit,
        remaining: limit - total,
        month,
        warning: total >= limit * 0.9 ? 'critical' : total >= limit * 0.7 ? 'warning' : null,
      };
    });

    this.commitMetricBatchTransaction = this.db.transaction((resourceId, source, buckets, cursor, timestamp) => {
      const updatedAt = new Date(timestamp).toISOString();
      const append = this.db.prepare(`
        INSERT INTO apm_metric_buckets (
          resource_id, bucket_start, metric_name, unit, sample_count, value_sum,
          value_min, value_max, value_last, source, quality, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (resource_id, bucket_start, metric_name, source) DO UPDATE SET
          unit = excluded.unit,
          sample_count = sample_count + excluded.sample_count,
          value_sum = value_sum + excluded.value_sum,
          value_min = CASE
            WHEN value_min IS NULL THEN excluded.value_min
            WHEN excluded.value_min IS NULL THEN value_min
            ELSE MIN(value_min, excluded.value_min)
          END,
          value_max = CASE
            WHEN value_max IS NULL THEN excluded.value_max
            WHEN excluded.value_max IS NULL THEN value_max
            ELSE MAX(value_max, excluded.value_max)
          END,
          value_last = COALESCE(excluded.value_last, value_last),
          quality = CASE WHEN quality = 'full' AND excluded.quality = 'full' THEN 'full' ELSE 'partial' END,
          updated_at = excluded.updated_at
      `);
      for (const bucket of buckets) {
        append.run(
          resourceId, Number(bucket.bucketStart), bucket.metricName, bucket.unit || 'count',
          Number(bucket.count) || 0, Number(bucket.sum) || 0,
          bucket.min == null ? null : Number(bucket.min),
          bucket.max == null ? null : Number(bucket.max),
          bucket.last == null ? null : Number(bucket.last),
          source, bucket.quality || 'full', updatedAt,
        );
      }
      this.db.prepare(`
        INSERT INTO apm_collection_cursors (
          resource_id, source, cursor_timestamp, next_token, boundary_hashes_json, state_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (resource_id, source) DO UPDATE SET
          cursor_timestamp = excluded.cursor_timestamp,
          next_token = excluded.next_token,
          boundary_hashes_json = excluded.boundary_hashes_json,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `).run(
        resourceId, source, cursor.timestamp ?? null, cursor.nextToken || null,
        JSON.stringify(cursor.boundaryHashes || []), JSON.stringify(cursor.state || {}), updatedAt,
      );
      return buckets.length;
    });
  }

  createApplication(input) {
    const timestamp = new Date(this.now()).toISOString();
    const application = {
      id: input.id || crypto.randomUUID(),
      provider: String(input.provider || '').trim().toLowerCase(),
      profileId: String(input.profileId || '').trim(),
      region: String(input.region || '').trim(),
      name: String(input.name || '').trim(),
      environment: String(input.environment || '').trim(),
      team: String(input.team || '').trim(),
      pollingEnabled: toBoolean(input.pollingEnabled),
    };
    if (!application.name) throw new Error('name is required');
    // A KUA Application (#149) has no provider or profile: its scopes carry them. The
    // legacy APM shape, bound to one provider/profile/region, is still accepted as is.
    const providerLess = !application.provider && !application.profileId && !application.region;
    if (!providerLess) {
      application.provider ||= 'aws';
      if (!application.profileId || !application.region) throw new Error('profileId, region and name are required');
      if (!PROVIDERS.has(application.provider)) throw new Error('Unsupported provider');
    }
    this.db.prepare(`
      INSERT INTO apm_applications (
        id, provider, profile_id, region, name, environment, team, polling_enabled,
        poll_interval_minutes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 30, ?, ?)
    `).run(
      application.id, application.provider || null, application.profileId || null, application.region || null, application.name,
      application.environment, application.team, providerLess ? 0 : application.pollingEnabled, timestamp, timestamp,
    );
    return this.getApplication(application.id);
  }

  getApplication(id) {
    const row = this.statements.applicationById.get(id);
    return row ? this._application(row) : null;
  }

  getApplicationByArchitectureProjectId(projectId) {
    const row = this.db.prepare(`
      SELECT a.* FROM apm_applications a
      LEFT JOIN apm_application_architecture_projects link ON link.application_id = a.id
        AND link.project_id = ?
      WHERE link.project_id IS NOT NULL OR a.architecture_project_id = ?
      ORDER BY a.updated_at DESC LIMIT 1
    `).get(projectId, projectId);
    return row ? this._application(row) : null;
  }

  listApplicationsByArchitectureProjectId(projectId) {
    return this.db.prepare(`
      SELECT DISTINCT a.* FROM apm_applications a
      LEFT JOIN apm_application_architecture_projects link ON link.application_id = a.id
        AND link.project_id = ?
      WHERE link.project_id IS NOT NULL OR a.architecture_project_id = ?
      ORDER BY a.name, a.environment
    `).all(projectId, projectId).map(row => this._application(row));
  }

  listArchitectureProjectsByApplicationId(applicationId) {
    return this.db.prepare(`
      SELECT project_id FROM apm_application_architecture_projects
      WHERE application_id = ? ORDER BY updated_at DESC, project_id
    `).all(applicationId).map(row => row.project_id);
  }

  listApplications({ provider, profileId, region } = {}) {
    const conditions = [];
    const values = [];
    if (provider) { conditions.push('provider = ?'); values.push(provider); }
    if (profileId) { conditions.push('profile_id = ?'); values.push(profileId); }
    if (region) { conditions.push('region = ?'); values.push(region); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM apm_applications ${where} ORDER BY name, environment`).all(...values)
      .map(row => this._application(row));
  }

  updateApplication(id, changes = {}) {
    const current = this.getApplication(id);
    if (!current) return null;
    const next = {
      name: changes.name === undefined ? current.name : String(changes.name).trim(),
      environment: changes.environment === undefined ? current.environment : String(changes.environment || '').trim(),
      team: changes.team === undefined ? current.team : String(changes.team || '').trim(),
      pollingEnabled: changes.pollingEnabled === undefined ? current.pollingEnabled : !!changes.pollingEnabled,
    };
    if (!next.name) throw new Error('name is required');
    this.db.prepare(`
      UPDATE apm_applications
      SET name = ?, environment = ?, team = ?, polling_enabled = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(next.name, next.environment, next.team, toBoolean(next.pollingEnabled), new Date(this.now()).toISOString(), id);
    return this.getApplication(id);
  }

  updateArchitectureProjectLink(id, architectureProjectId) {
    const application = this.getApplication(id);
    if (!application) return null;
    const timestamp = new Date(this.now()).toISOString();
    if (architectureProjectId) {
      this.db.prepare(`
        INSERT INTO apm_application_architecture_projects (application_id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (application_id, project_id) DO UPDATE SET updated_at = excluded.updated_at
      `).run(id, architectureProjectId, timestamp, timestamp);
    } else {
      this.db.prepare('DELETE FROM apm_application_architecture_projects WHERE application_id = ?').run(id);
    }
    this.db.prepare(`
      UPDATE apm_applications SET architecture_project_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?
    `).run(architectureProjectId || null, timestamp, id);
    return this.getApplication(id);
  }

  unlinkArchitectureProject(id, projectId) {
    const application = this.getApplication(id);
    if (!application) return null;
    const timestamp = new Date(this.now()).toISOString();
    if (projectId) {
      this.db.prepare(`DELETE FROM apm_application_architecture_projects WHERE application_id = ? AND project_id = ?`)
        .run(id, projectId);
    } else {
      this.db.prepare('DELETE FROM apm_application_architecture_projects WHERE application_id = ?').run(id);
    }
    const nextProjectId = this.listArchitectureProjectsByApplicationId(id)[0] || null;
    this.db.prepare(`UPDATE apm_applications SET architecture_project_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
      .run(nextProjectId, timestamp, id);
    return this.getApplication(id);
  }

  // ── KUA Application scopes and local bindings (#149) ──────────────────────
  // Scopes are portable (they travel with the application); a binding ties a scope to a
  // profile of this computer and is never exported. Callers pass scopes already normalized
  // by lib/kua/applicationContract.js (normalizeScope).

  listApplicationScopes(applicationId) {
    return this.db.prepare(`
      SELECT * FROM kua_application_scopes WHERE application_id = ? ORDER BY provider, scope_id, location
    `).all(applicationId).map(row => ({
      key: row.scope_key, provider: row.provider, scopeId: row.scope_id, location: row.location,
      label: row.label, createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  /** Adds a scope once; returns true when it was new (the application revision moves). */
  addApplicationScope(applicationId, scope) {
    const timestamp = new Date(this.now()).toISOString();
    return this.db.transaction(() => {
      const { changes } = this.db.prepare(`
        INSERT INTO kua_application_scopes (application_id, scope_key, provider, scope_id, location, label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (application_id, scope_key) DO NOTHING
      `).run(applicationId, scope.key, scope.provider, scope.scopeId || '', scope.location || '', scope.label || '', timestamp, timestamp);
      if (changes) this.db.prepare('UPDATE apm_applications SET revision = revision + 1, updated_at = ? WHERE id = ?').run(timestamp, applicationId);
      return changes > 0;
    })();
  }

  removeApplicationScope(applicationId, scopeKey) {
    const timestamp = new Date(this.now()).toISOString();
    return this.db.transaction(() => {
      const { changes } = this.db.prepare('DELETE FROM kua_application_scopes WHERE application_id = ? AND scope_key = ?').run(applicationId, scopeKey);
      if (changes) this.db.prepare('UPDATE apm_applications SET revision = revision + 1, updated_at = ? WHERE id = ?').run(timestamp, applicationId);
      return changes > 0;
    })();
  }

  /**
   * Completes a scope whose account/project was unknown: the new scope replaces the old one
   * and the binding moves with it. If the application already had the completed scope, the
   * pending one is only removed. One revision either way.
   */
  completeApplicationScope(applicationId, oldScopeKey, scope, binding) {
    const timestamp = new Date(this.now()).toISOString();
    return this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO kua_application_scopes (application_id, scope_key, provider, scope_id, location, label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (application_id, scope_key) DO NOTHING
      `).run(applicationId, scope.key, scope.provider, scope.scopeId || '', scope.location || '', scope.label || '', timestamp, timestamp);
      this.setScopeBinding(applicationId, scope.key, binding);
      if (oldScopeKey !== scope.key) this.db.prepare('DELETE FROM kua_application_scopes WHERE application_id = ? AND scope_key = ?').run(applicationId, oldScopeKey);
      this.db.prepare('UPDATE apm_applications SET revision = revision + 1, updated_at = ? WHERE id = ?').run(timestamp, applicationId);
      return this.getScopeBinding(applicationId, scope.key);
    })();
  }

  listScopeBindings(applicationId) {
    return this.db.prepare('SELECT * FROM kua_scope_bindings WHERE application_id = ? ORDER BY scope_key')
      .all(applicationId).map(row => this._scopeBinding(row));
  }

  getScopeBinding(applicationId, scopeKey) {
    const row = this.db.prepare('SELECT * FROM kua_scope_bindings WHERE application_id = ? AND scope_key = ?').get(applicationId, scopeKey);
    return row ? this._scopeBinding(row) : null;
  }

  /** Sets a binding; with { onlyIfMissing } an existing binding (a user decision) is kept. */
  setScopeBinding(applicationId, scopeKey, { profileId, status = 'unverified', verifiedIdentity = null, verifiedAt = null, lastError = null } = {}, { onlyIfMissing = false } = {}) {
    const timestamp = new Date(this.now()).toISOString();
    const profile = String(profileId || '').trim();
    if (!profile) throw new Error('profileId is required');
    this.db.prepare(`
      INSERT INTO kua_scope_bindings (
        application_id, scope_key, profile_id, status, verified_identity, verified_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (application_id, scope_key) DO ${onlyIfMissing ? 'NOTHING' : `UPDATE SET
        profile_id = excluded.profile_id, status = excluded.status, verified_identity = excluded.verified_identity,
        verified_at = excluded.verified_at, last_error = excluded.last_error, updated_at = excluded.updated_at`}
    `).run(applicationId, scopeKey, profile, status, verifiedIdentity, verifiedAt, lastError, timestamp, timestamp);
    return this.getScopeBinding(applicationId, scopeKey);
  }

  removeScopeBinding(applicationId, scopeKey) {
    return this.db.prepare('DELETE FROM kua_scope_bindings WHERE application_id = ? AND scope_key = ?').run(applicationId, scopeKey).changes > 0;
  }

  _scopeBinding(row) {
    return {
      applicationId: row.application_id, scopeKey: row.scope_key, profileId: row.profile_id, status: row.status,
      verifiedIdentity: row.verified_identity || null, verifiedAt: row.verified_at || null,
      lastError: row.last_error || null, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  // ── Registry identity v2 cutover (#149) ───────────────────────────────────

  /** Local registry rows still keyed by identity v1 (which embeds the profile). */
  listLegacyRegistryResources() {
    return this.db.prepare(`
      SELECT r.*, (SELECT json_group_array(DISTINCT m.application_id) FROM kua_registry_memberships m WHERE m.resource_id = r.id) AS application_ids
      FROM kua_registry_resources r WHERE r.identity_key NOT LIKE '["v2",%'
    `).all().map(row => ({ ...this._registryResource(row), applicationIds: parseJson(row.application_ids, []) }));
  }

  /**
   * Drops every v1 registry row (memberships and relationships cascade) and records the
   * resources identity v2 merges. The registry is derived from APM resources and
   * architecture graphs, where human decisions live, so reconciling rebuilds it.
   */
  dropLegacyRegistry(merges = []) {
    const timestamp = new Date(this.now()).toISOString();
    return this.db.transaction(() => {
      const record = this.db.prepare(`
        INSERT INTO kua_registry_identity_merges (identity_key, merged_count, application_ids_json, detected_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (identity_key) DO UPDATE SET merged_count = excluded.merged_count,
          application_ids_json = excluded.application_ids_json, detected_at = excluded.detected_at
      `);
      for (const merge of merges) record.run(merge.identityKey, merge.mergedCount, JSON.stringify(merge.applicationIds || []), timestamp);
      return this.db.prepare(`DELETE FROM kua_registry_resources WHERE identity_key NOT LIKE '["v2",%'`).run().changes;
    })();
  }

  listRegistryIdentityMerges() {
    return this.db.prepare('SELECT * FROM kua_registry_identity_merges ORDER BY detected_at DESC, identity_key').all()
      .map(row => ({ identityKey: row.identity_key, mergedCount: row.merged_count, applicationIds: parseJson(row.application_ids_json, []), detectedAt: row.detected_at }));
  }

  upsertRegistryResource(input) {
    const identityKey = String(input.identityKey || '').trim();
    const id = String(input.id || '').trim();
    const provider = String(input.provider || '').trim();
    const profileId = String(input.profileId || '').trim();
    const nativeIdentifier = String(input.nativeIdentifier || '').trim();
    const resourceType = String(input.resourceType || '').trim();
    const displayName = String(input.displayName || '').trim();
    // The profile is only local lineage now: identity v2 does not include it (#149).
    if (!identityKey || !id || !provider || !nativeIdentifier || !resourceType || !displayName) {
      throw new Error('Registry resource identity, provider, type and name are required');
    }
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO kua_registry_resources (
        id, identity_key, provider, profile_id, scope_id, location, native_identifier,
        resource_type, display_name, lineage_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identity_key) DO UPDATE SET
        display_name = excluded.display_name,
        lineage_json = excluded.lineage_json,
        updated_at = excluded.updated_at
    `).run(
      id, identityKey, provider, profileId, String(input.scopeId || ''), String(input.location || ''),
      nativeIdentifier, resourceType, displayName, JSON.stringify(input.lineage || []), timestamp, timestamp,
    );
    return this._registryResource(this.db.prepare('SELECT * FROM kua_registry_resources WHERE identity_key = ?').get(identityKey));
  }

  addRegistryMembership(input) {
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO kua_registry_memberships (
        application_id, resource_id, source_kind, source_reference, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(application_id, resource_id, source_kind, source_reference) DO UPDATE SET
        updated_at = excluded.updated_at
    `).run(input.applicationId, input.resourceId, input.sourceKind, input.sourceReference, timestamp, timestamp);
  }

  listRegistryDetachmentKeys(applicationId) {
    return this.db.prepare('SELECT DISTINCT identity_key FROM kua_registry_detachments WHERE application_id = ?')
      .all(applicationId).map(row => row.identity_key);
  }

  isRegistryResourceDetached(applicationId, resourceId) {
    return !!this.db.prepare('SELECT 1 FROM kua_registry_detachments WHERE application_id = ? AND resource_id = ?')
      .get(applicationId, resourceId);
  }

  clearRegistryDetachment(applicationId, identityKey) {
    return this.db.prepare('DELETE FROM kua_registry_detachments WHERE application_id = ? AND identity_key = ?')
      .run(applicationId, identityKey).changes;
  }

  /**
   * Keeps only the current (resource, source) pairs of one source kind. A source whose
   * identity changed (its account or region became known) leaves no membership behind.
   */
  pruneRegistryMembershipPairs(applicationId, sourceKind, pairs = []) {
    const keep = JSON.stringify(pairs.map(pair => `${pair.resourceId}\u0000${pair.sourceReference}`));
    return this.db.prepare(`
      DELETE FROM kua_registry_memberships
      WHERE application_id = ? AND source_kind = ?
        AND (resource_id || char(0) || source_reference) NOT IN (SELECT value FROM json_each(?))
    `).run(applicationId, sourceKind, keep).changes;
  }

  pruneRegistryMemberships(applicationId, sourceKind, sourceReferences = []) {
    if (!sourceReferences.length) {
      return this.db.prepare(`
        DELETE FROM kua_registry_memberships WHERE application_id = ? AND source_kind = ?
      `).run(applicationId, sourceKind).changes;
    }
    const placeholders = sourceReferences.map(() => '?').join(', ');
    return this.db.prepare(`
      DELETE FROM kua_registry_memberships
      WHERE application_id = ? AND source_kind = ? AND source_reference NOT IN (${placeholders})
    `).run(applicationId, sourceKind, ...sourceReferences).changes;
  }

  upsertRegistryRelationship(input) {
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO kua_registry_relationships (
        id, application_id, source_resource_id, target_resource_id, relation_type, status,
        evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(application_id, source_resource_id, target_resource_id, relation_type) DO UPDATE SET
        status = excluded.status, evidence_json = excluded.evidence_json, updated_at = excluded.updated_at
    `).run(
      input.id, input.applicationId, input.sourceResourceId, input.targetResourceId,
      input.relationType, input.status, JSON.stringify(input.evidence || []), timestamp, timestamp,
    );
    return this._registryRelationship(this.db.prepare('SELECT * FROM kua_registry_relationships WHERE id = ?').get(input.id));
  }

  pruneRegistryRelationships(applicationId, relationshipIds = []) {
    if (!relationshipIds.length) {
      return this.db.prepare('DELETE FROM kua_registry_relationships WHERE application_id = ?').run(applicationId).changes;
    }
    const placeholders = relationshipIds.map(() => '?').join(', ');
    return this.db.prepare(`
      DELETE FROM kua_registry_relationships
      WHERE application_id = ? AND id NOT IN (${placeholders})
    `).run(applicationId, ...relationshipIds).changes;
  }

  listRegistryResources(applicationId) {
    return this.db.prepare(`
      SELECT r.*, GROUP_CONCAT(DISTINCT m.source_kind) AS source_kinds
      FROM kua_registry_resources r
      JOIN kua_registry_memberships m ON m.resource_id = r.id
      WHERE m.application_id = ?
      GROUP BY r.id
      ORDER BY r.provider, r.resource_type, r.display_name
    `).all(applicationId).map(row => this._registryResource(row));
  }

  listRegistryRelationships(applicationId) {
    return this.db.prepare(`
      SELECT * FROM kua_registry_relationships WHERE application_id = ?
      ORDER BY relation_type, source_resource_id, target_resource_id
    `).all(applicationId).map(row => this._registryRelationship(row));
  }

  recordRegistrySyncSuccess(applicationId, { durationMs, divergentResourceCount = 0, divergentRelationshipCount = 0 } = {}) {
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO kua_registry_sync_status (
        application_id, last_success_at, last_error, last_error_at, last_duration_ms,
        divergent_resource_count, divergent_relationship_count, updated_at
      ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT(application_id) DO UPDATE SET
        last_success_at = excluded.last_success_at,
        last_error = NULL,
        last_error_at = NULL,
        last_duration_ms = excluded.last_duration_ms,
        divergent_resource_count = excluded.divergent_resource_count,
        divergent_relationship_count = excluded.divergent_relationship_count,
        updated_at = excluded.updated_at
    `).run(applicationId, timestamp, durationMs ?? null, divergentResourceCount, divergentRelationshipCount, timestamp);
    return this.getRegistrySyncStatus(applicationId);
  }

  recordRegistrySyncFailure(applicationId, { durationMs, error } = {}) {
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO kua_registry_sync_status (
        application_id, last_success_at, last_error, last_error_at, last_duration_ms,
        divergent_resource_count, divergent_relationship_count, updated_at
      ) VALUES (?, NULL, ?, ?, ?, 0, 0, ?)
      ON CONFLICT(application_id) DO UPDATE SET
        last_error = excluded.last_error,
        last_error_at = excluded.last_error_at,
        last_duration_ms = excluded.last_duration_ms,
        updated_at = excluded.updated_at
    `).run(applicationId, String(error || 'Unknown error').slice(0, 500), timestamp, durationMs ?? null, timestamp);
    return this.getRegistrySyncStatus(applicationId);
  }

  getRegistrySyncStatus(applicationId) {
    const row = this.db.prepare('SELECT * FROM kua_registry_sync_status WHERE application_id = ?').get(applicationId);
    if (!row) return null;
    return {
      applicationId: row.application_id,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      lastErrorAt: row.last_error_at,
      lastDurationMs: row.last_duration_ms,
      divergentResourceCount: row.divergent_resource_count,
      divergentRelationshipCount: row.divergent_relationship_count,
      updatedAt: row.updated_at,
    };
  }

  updateThresholds(id, changes = {}) {
    const current = this.getApplication(id);
    if (!current) return null;
    const thresholds = normalizeThresholds(changes, current.thresholds);
    this.db.prepare(`
      UPDATE apm_applications SET thresholds_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(thresholds), new Date(this.now()).toISOString(), id);
    return this.getApplication(id).thresholds;
  }

  deleteApplication(id) {
    return this.db.prepare('DELETE FROM apm_applications WHERE id = ?').run(id).changes > 0;
  }

  addResource(applicationId, input, options = {}) {
    return this.attachResource(applicationId, input, options).resource;
  }

  attachResource(applicationId, input = {}, { expectedRevision } = {}) {
    return this.db.transaction(() => {
      const application = this.getApplication(applicationId);
      if (!application) throw new Error('Application not found');
      checkApplicationRevision(application, expectedRevision);
      const resource = {
        id: input.id || crypto.randomUUID(),
        provider: String(input.provider || application.provider || 'aws').trim().toLowerCase(),
        type: input.type,
        key: String(input.key || '').trim(),
        name: String(input.name || '').trim(),
        associationSource: input.associationSource || 'manual',
      };
      if (!RESOURCE_TYPES.has(resource.type)) throw new Error('Unsupported resource type');
      if (!PROVIDERS.has(resource.provider)) throw new Error('Unsupported provider');
      if (!resource.key || !resource.name) throw new Error('Resource key and name are required');
      if (!['manual', 'tags', 'labels', 'deployment', 'architecture'].includes(resource.associationSource)) throw new Error('Unsupported association source');

      const existing = this.db.prepare(`
        SELECT id FROM apm_resources WHERE application_id = ? AND resource_type = ? AND resource_key = ?
      `).get(applicationId, resource.type, resource.key);
      if (existing) return { created: false, resource: this.getResource(existing.id) };

      const timestamp = new Date(this.now()).toISOString();
      this.db.prepare(`
        INSERT INTO apm_resources (
          id, application_id, provider, resource_type, resource_key, arn, kube_context, namespace,
          kind, name, service, log_group, metadata_json, association_source, enabled,
          created_at, updated_at, scope_id, location
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        resource.id, applicationId, resource.provider, resource.type, resource.key, input.arn || null,
        input.kubeContext || null, input.namespace || null, input.kind || null,
        resource.name, String(input.service || ''), input.logGroup || null,
        '{}', resource.associationSource,
        input.enabled === false ? 0 : 1, timestamp, timestamp,
        String(input.scopeId || '').trim(), String(input.location || '').trim(),
      );
      this.db.prepare('UPDATE apm_applications SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, applicationId);
      return { created: true, resource: this.getResource(resource.id) };
    })();
  }

  upsertArchitectureResource(applicationId, input) {
    if (!this.getApplication(applicationId)) throw new Error('Application not found');
    const type = String(input.type || '').trim();
    const provider = String(input.provider || this.getApplication(applicationId).provider || 'generic').trim().toLowerCase();
    const key = String(input.key || '').trim();
    const name = String(input.name || '').trim();
    if (!RESOURCE_TYPES.has(type)) throw new Error('Unsupported resource type');
    if (!PROVIDERS.has(provider)) throw new Error('Unsupported provider');
    if (!key || !name) throw new Error('Resource key and name are required');
    const existing = this.db.prepare(`
      SELECT * FROM apm_resources
      WHERE application_id = ? AND resource_type = ? AND resource_key = ?
    `).get(applicationId, type, key);
    if (!existing) {
      return this.addResource(applicationId, {
        ...input, provider, type, key, name, associationSource: 'architecture',
      });
    }
    const associationSource = existing.association_source === 'architecture'
      ? 'architecture'
      : existing.association_source;
    this.db.prepare(`
      UPDATE apm_resources
      SET provider = ?, arn = ?, kube_context = ?, namespace = ?, kind = ?, name = ?,
        service = ?, log_group = ?, association_source = ?, updated_at = ?,
        scope_id = CASE WHEN ? <> '' THEN ? ELSE scope_id END,
        location = CASE WHEN ? <> '' THEN ? ELSE location END
      WHERE id = ?
    `).run(
      existing.association_source === 'architecture' ? provider : existing.provider,
      input.arn || null, input.kubeContext || null, input.namespace || null, input.kind || null,
      name, String(input.service || ''), input.logGroup || null, associationSource,
      new Date(this.now()).toISOString(),
      String(input.scopeId || ''), String(input.scopeId || ''), String(input.location || ''), String(input.location || ''),
      existing.id,
    );
    return this.getResource(existing.id);
  }

  pruneArchitectureResources(applicationId, keys = []) {
    const normalizedKeys = [...new Set(keys.map(value => String(value || '').trim()).filter(Boolean))];
    if (!normalizedKeys.length) {
      return this.db.prepare(`
        DELETE FROM apm_resources WHERE application_id = ? AND association_source = 'architecture'
      `).run(applicationId).changes;
    }
    const placeholders = normalizedKeys.map(() => '?').join(', ');
    return this.db.prepare(`
      DELETE FROM apm_resources
      WHERE application_id = ? AND association_source = 'architecture' AND resource_key NOT IN (${placeholders})
    `).run(applicationId, ...normalizedKeys).changes;
  }

  getResource(id) {
    const row = this.statements.resourceById.get(id);
    return row ? this._resource(row) : null;
  }

  listResources(applicationId, { enabledOnly = false } = {}) {
    const suffix = enabledOnly ? ' AND enabled = 1' : '';
    return this.db.prepare(`SELECT * FROM apm_resources WHERE application_id = ?${suffix} ORDER BY resource_type, name`)
      .all(applicationId).map(row => this._resource(row));
  }

  updateResource(id, changes = {}, { expectedRevision } = {}) {
    return this.db.transaction(() => {
      const current = this.getResource(id);
      if (!current) return null;
      const application = this.getApplication(current.applicationId);
      checkApplicationRevision(application, expectedRevision);
      const next = {
        name: changes.name === undefined ? current.name : String(changes.name || '').trim(),
        service: changes.service === undefined ? current.service : String(changes.service || '').trim(),
        logGroup: changes.logGroup === undefined ? current.logGroup : changes.logGroup || null,
        enabled: changes.enabled === undefined ? current.enabled : !!changes.enabled,
      };
      if (!next.name) throw new Error('Resource name is required');
      if (next.name === current.name && next.service === current.service && next.logGroup === current.logGroup && next.enabled === current.enabled) {
        return current;
      }
      const timestamp = new Date(this.now()).toISOString();
      this.db.prepare(`
        UPDATE apm_resources
        SET name = ?, service = ?, log_group = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(next.name, next.service, next.logGroup, toBoolean(next.enabled), timestamp, id);
      this.db.prepare('UPDATE apm_applications SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, current.applicationId);
      return this.getResource(id);
    })();
  }

  removeResource(id, { expectedRevision, identityKey } = {}) {
    return this.db.transaction(() => {
      const current = this.getResource(id);
      if (!current) return false;
      const application = this.getApplication(current.applicationId);
      checkApplicationRevision(application, expectedRevision);
      const timestamp = new Date(this.now()).toISOString();
      const removed = this.db.prepare('DELETE FROM apm_resources WHERE id = ?').run(id).changes > 0;
      if (removed) {
        if (identityKey) {
          this.db.prepare(`
            INSERT INTO kua_registry_detachments (application_id, resource_id, identity_key, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (application_id, resource_id) DO UPDATE SET
              identity_key = excluded.identity_key, created_at = excluded.created_at
          `).run(current.applicationId, id, identityKey, timestamp);
        }
        this.db.prepare('UPDATE apm_applications SET revision = revision + 1, updated_at = ? WHERE id = ?')
          .run(timestamp, current.applicationId);
      }
      return removed;
    })();
  }

  addEdge(applicationId, input) {
    const source = this.getResource(input.sourceResourceId);
    const target = this.getResource(input.targetResourceId);
    if (!source || !target || source.applicationId !== applicationId || target.applicationId !== applicationId) {
      throw new Error('Both resources must belong to the application');
    }
    const id = input.id || crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO apm_edges (
        id, application_id, source_resource_id, target_resource_id, relation_type, confirmed, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(id, applicationId, source.id, target.id, input.relationType || 'depends_on', new Date(this.now()).toISOString());
    return this.db.prepare('SELECT * FROM apm_edges WHERE id = ?').get(id);
  }

  listEdges(applicationId) {
    return this.db.prepare(`
      SELECT id, application_id AS applicationId, source_resource_id AS sourceResourceId,
        target_resource_id AS targetResourceId, relation_type AS relationType, created_at AS createdAt
      FROM apm_edges WHERE application_id = ? ORDER BY created_at
    `).all(applicationId);
  }

  removeEdge(id) {
    return this.db.prepare('DELETE FROM apm_edges WHERE id = ?').run(id).changes > 0;
  }

  getOverview(applicationId, { from, to } = {}) {
    const end = Number.isFinite(Number(to)) ? Number(to) : this.now();
    const start = Number.isFinite(Number(from)) ? Number(from) : end - 24 * 60 * 60 * 1000;
    const resources = this.db.prepare(`
      SELECT resource_type AS type, COUNT(*) AS count,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
      FROM apm_resources WHERE application_id = ? GROUP BY resource_type ORDER BY resource_type
    `).all(applicationId);
    const metrics = this.db.prepare(`
      SELECT b.metric_name AS metricName, b.unit,
        SUM(b.sample_count) AS count, SUM(b.value_sum) AS sum,
        MIN(b.value_min) AS min, MAX(b.value_max) AS max,
        CASE WHEN SUM(CASE WHEN b.quality = 'partial' THEN 1 ELSE 0 END) > 0
          THEN 'partial' ELSE 'full' END AS quality
      FROM apm_metric_buckets b
      JOIN apm_resources r ON r.id = b.resource_id
      WHERE r.application_id = ? AND b.bucket_start >= ? AND b.bucket_start <= ?
      GROUP BY b.metric_name, b.unit ORDER BY b.metric_name
    `).all(applicationId, start, end).map(metricRow => ({
      ...metricRow,
      average: metricRow.count ? metricRow.sum / metricRow.count : null,
    }));
    // Same aggregation split per resource type (and Kubernetes kind) so the UI can
    // render provider-agnostic per-resource-type KPIs without extra round trips.
    const metricsByResourceType = this.db.prepare(`
      SELECT r.resource_type AS resourceType, COALESCE(r.kind, '') AS kind,
        b.metric_name AS metricName, b.unit,
        SUM(b.sample_count) AS count, SUM(b.value_sum) AS sum,
        MIN(b.value_min) AS min, MAX(b.value_max) AS max,
        CASE WHEN SUM(CASE WHEN b.quality = 'partial' THEN 1 ELSE 0 END) > 0
          THEN 'partial' ELSE 'full' END AS quality
      FROM apm_metric_buckets b
      JOIN apm_resources r ON r.id = b.resource_id
      WHERE r.application_id = ? AND b.bucket_start >= ? AND b.bucket_start <= ?
      GROUP BY r.resource_type, kind, b.metric_name, b.unit
      ORDER BY r.resource_type, kind, b.metric_name
    `).all(applicationId, start, end).map(metricRow => ({
      ...metricRow,
      average: metricRow.count ? metricRow.sum / metricRow.count : null,
    }));
    return { from: start, to: end, resources, metrics, metricsByResourceType };
  }

  upsertMetricBucket(input) {
    const timestamp = new Date(this.now()).toISOString();
    const count = Number(input.count) || 0;
    const sum = Number(input.sum) || 0;
    const minimum = input.min == null ? null : Number(input.min);
    const maximum = input.max == null ? null : Number(input.max);
    const last = input.last == null ? null : Number(input.last);
    this.db.prepare(`
      INSERT INTO apm_metric_buckets (
        resource_id, bucket_start, metric_name, unit, sample_count, value_sum,
        value_min, value_max, value_last, source, quality, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (resource_id, bucket_start, metric_name, source) DO UPDATE SET
        unit = excluded.unit,
        sample_count = excluded.sample_count,
        value_sum = excluded.value_sum,
        value_min = excluded.value_min,
        value_max = excluded.value_max,
        value_last = excluded.value_last,
        quality = excluded.quality,
        updated_at = excluded.updated_at
    `).run(
      input.resourceId, Number(input.bucketStart), input.metricName, input.unit || 'count',
      count, sum, minimum, maximum, last, input.source, input.quality || 'full', timestamp,
    );
  }

  getMetricSeries({ applicationId, resourceId, resourceType, kind, metricName, from, to }) {
    const conditions = ['r.application_id = ?', 'b.metric_name = ?', 'b.bucket_start >= ?', 'b.bucket_start <= ?'];
    const values = [applicationId, metricName, Number(from), Number(to)];
    if (resourceId) { conditions.push('b.resource_id = ?'); values.push(resourceId); }
    if (resourceType) { conditions.push('r.resource_type = ?'); values.push(resourceType); }
    if (kind) { conditions.push('r.kind = ?'); values.push(kind); }
    return this.db.prepare(`
      SELECT b.resource_id AS resourceId, r.name AS resourceName, r.resource_type AS resourceType,
        r.kind, b.bucket_start AS bucketStart,
        b.metric_name AS metricName, b.unit, b.sample_count AS count, b.value_sum AS sum,
        b.value_min AS min, b.value_max AS max, b.value_last AS last, b.source, b.quality
      FROM apm_metric_buckets b
      JOIN apm_resources r ON r.id = b.resource_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.bucket_start, r.name
    `).all(...values).map(row => ({
      ...row,
      average: row.count ? row.sum / row.count : null,
    }));
  }

  commitMetricBatch(resourceId, source, buckets, cursor) {
    if (!resourceId || !source) throw new Error('resourceId and source are required');
    return this.commitMetricBatchTransaction(resourceId, source, buckets || [], cursor || {}, this.now());
  }

  setCursor(resourceId, source, cursor = {}) {
    const timestamp = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO apm_collection_cursors (
        resource_id, source, cursor_timestamp, next_token, boundary_hashes_json, state_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (resource_id, source) DO UPDATE SET
        cursor_timestamp = excluded.cursor_timestamp,
        next_token = excluded.next_token,
        boundary_hashes_json = excluded.boundary_hashes_json,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(
      resourceId, source, cursor.timestamp ?? null, cursor.nextToken || null,
      JSON.stringify(cursor.boundaryHashes || []), JSON.stringify(cursor.state || {}), timestamp,
    );
  }

  getCursor(resourceId, source) {
    const row = this.statements.cursor.get(resourceId, source);
    if (!row) return null;
    return {
      timestamp: row.cursor_timestamp,
      nextToken: row.next_token,
      boundaryHashes: parseJson(row.boundary_hashes_json, []),
      state: parseJson(row.state_json, {}),
      updatedAt: row.updated_at,
    };
  }

  startCollectionRun(input) {
    const id = input.id || crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO apm_collection_runs (
        id, application_id, profile_id, region, trigger, status, started_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?)
    `).run(id, input.applicationId || null, input.profileId, input.region, input.trigger, new Date(this.now()).toISOString());
    return id;
  }

  finishCollectionRun(id, result = {}) {
    this.db.prepare(`
      UPDATE apm_collection_runs
      SET status = ?, finished_at = ?, request_count = ?, backlog = ?, error_code = ?, error_message = ?
      WHERE id = ?
    `).run(
      result.status || 'completed', new Date(this.now()).toISOString(), Number(result.requestCount) || 0,
      toBoolean(result.backlog), result.errorCode || null,
      result.errorMessage ? String(result.errorMessage).slice(0, 500) : null, id,
    );
  }

  getCollectionRun(id) {
    const row = this.db.prepare(`
      SELECT id, application_id AS applicationId, profile_id AS profileId, region,
        trigger, status, started_at AS startedAt, finished_at AS finishedAt,
        request_count AS requestCount, backlog, error_code AS errorCode,
        error_message AS errorMessage
      FROM apm_collection_runs WHERE id = ?
    `).get(id);
    return row ? { ...row, backlog: !!row.backlog } : null;
  }

  getLatestCollectionRun(applicationId) {
    const row = this.db.prepare(`
      SELECT id, application_id AS applicationId, profile_id AS profileId, region,
        trigger, status, started_at AS startedAt, finished_at AS finishedAt,
        request_count AS requestCount, backlog, error_code AS errorCode,
        error_message AS errorMessage
      FROM apm_collection_runs
      WHERE application_id = ?
      ORDER BY started_at DESC LIMIT 1
    `).get(applicationId);
    return row ? { ...row, backlog: !!row.backlog } : null;
  }

  reserveAwsRequests({ profileId, region, operation, count = 1, limit = DEFAULT_MONTHLY_REQUEST_LIMIT }) {
    if (!profileId || !region || !operation) throw new Error('profileId, region and operation are required');
    const requested = Math.max(1, Math.floor(Number(count) || 1));
    return this.reserveApiRequests(profileId, region, operation, requested, limit, this.now());
  }

  getApiUsage(profileId, timestamp = this.now()) {
    const month = monthUtc(timestamp);
    const operations = this.db.prepare(`
      SELECT region, operation, request_count AS requestCount
      FROM apm_api_usage
      WHERE profile_id = ? AND month_utc = ?
      ORDER BY region, operation
    `).all(profileId, month);
    return {
      month,
      total: operations.reduce((sum, row) => sum + row.requestCount, 0),
      limit: DEFAULT_MONTHLY_REQUEST_LIMIT,
      operations,
    };
  }

  cleanup({ retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
    const cutoffMs = this.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();
    const metrics = this.db.prepare('DELETE FROM apm_metric_buckets WHERE bucket_start < ?').run(cutoffMs).changes;
    const cursors = this.db.prepare('DELETE FROM apm_collection_cursors WHERE updated_at < ?').run(cutoffIso).changes;
    const runs = this.db.prepare('DELETE FROM apm_collection_runs WHERE started_at < ?').run(cutoffIso).changes;
    const usageCutoff = new Date(this.now());
    usageCutoff.setUTCMonth(usageCutoff.getUTCMonth() - 15);
    const usage = this.db.prepare('DELETE FROM apm_api_usage WHERE month_utc < ?').run(monthUtc(usageCutoff.getTime())).changes;
    this.db.pragma('incremental_vacuum(200)');
    return { metrics, cursors, runs, usage };
  }

  health() {
    return {
      ready: this.db.open,
      schemaVersion: this.db.pragma('user_version', { simple: true }),
      journalMode: this.db.pragma('journal_mode', { simple: true }),
    };
  }

  close() {
    if (this.db?.open) this.db.close();
  }

  _application(row) {
    const architectureProjectIds = this.listArchitectureProjectsByApplicationId(row.id);
    const legacyProjectId = row.architecture_project_id || null;
    if (legacyProjectId && !architectureProjectIds.includes(legacyProjectId)) architectureProjectIds.unshift(legacyProjectId);
    return {
      id: row.id,
      // Null for a KUA Application without a legacy provider/profile/region (#149).
      provider: row.provider || (row.profile_id ? 'aws' : null),
      profileId: row.profile_id || null,
      region: row.region || null,
      revision: row.revision || 0,
      name: row.name,
      environment: row.environment,
      team: row.team,
      architectureProjectId: architectureProjectIds[0] || null,
      architectureProjectIds,
      pollingEnabled: !!row.polling_enabled,
      pollIntervalMinutes: row.poll_interval_minutes,
      thresholds: normalizeThresholds(parseJson(row.thresholds_json, {})),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _resource(row) {
    return {
      id: row.id,
      applicationId: row.application_id,
      provider: row.provider || 'aws',
      type: row.resource_type,
      key: row.resource_key,
      arn: row.arn,
      kubeContext: row.kube_context,
      namespace: row.namespace,
      kind: row.kind,
      name: row.name,
      service: row.service,
      logGroup: row.log_group,
      scopeId: row.scope_id || '',
      location: row.location || '',
      associationSource: row.association_source,
      enabled: !!row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _registryResource(row) {
    return {
      id: row.id,
      identityKey: row.identity_key,
      provider: row.provider,
      profileId: row.profile_id,
      scopeId: row.scope_id,
      location: row.location,
      nativeIdentifier: row.native_identifier,
      resourceType: row.resource_type,
      displayName: row.display_name,
      lineage: parseJson(row.lineage_json, []),
      sources: row.source_kinds ? row.source_kinds.split(',') : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _registryRelationship(row) {
    return {
      id: row.id,
      applicationId: row.application_id,
      sourceResourceId: row.source_resource_id,
      targetResourceId: row.target_resource_id,
      relationType: row.relation_type,
      status: row.status,
      evidence: parseJson(row.evidence_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let singleton = null;

function getApmDatabase(options) {
  if (!singleton) singleton = new ApmDatabase(options);
  return singleton;
}

function closeApmDatabase() {
  if (!singleton) return;
  singleton.close();
  singleton = null;
}

// Latest schema version: the database reports it as PRAGMA user_version.
const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

module.exports = {
  ApmDatabase,
  SCHEMA_VERSION,
  DEFAULT_MONTHLY_REQUEST_LIMIT,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_THRESHOLDS,
  closeApmDatabase,
  getApmDatabase,
  monthUtc,
  normalizeThresholds,
  resolveDataDir,
};
