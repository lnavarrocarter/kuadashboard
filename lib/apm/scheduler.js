'use strict';

const POLL_INTERVAL_MS = 30 * 60 * 1000;

function scopeKey(application) {
  return `${application.provider || 'aws'}\u0000${application.profileId}\u0000${application.region}`;
}

function collectionErrorCode(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (/ExpiredToken|expired/i.test(name) || /security token.*expired/i.test(message)) {
    return 'credentials_expired';
  }
  return name || 'collection_failed';
}

class ApmScheduler {
  constructor({
    database,
    awsCollector,
    kubeCollector,
    awsMetricCollector = null,
    intervalMs = POLL_INTERVAL_MS,
    timers = { setInterval, clearInterval },
    logger = console,
  }) {
    if (!database || !awsCollector || !kubeCollector) throw new Error('database and collectors are required');
    this.database = database;
    this.awsCollector = awsCollector;
    this.kubeCollector = kubeCollector;
    this.awsMetricCollector = awsMetricCollector;
    this.intervalMs = intervalMs;
    this.timers = timers;
    this.logger = logger;
    this.activeScopes = new Set();
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = this.timers.setInterval(() => {
      this.runScheduled().catch(error => this.logger.error('[apm] Scheduled collection failed:', error.message));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  health() {
    return {
      running: !!this.timer,
      activeScopes: this.activeScopes.size,
      intervalMinutes: this.intervalMs / 60000,
    };
  }

  async runScheduled() {
    const applications = this.database.listApplications().filter(application => application.pollingEnabled);
    const groups = new Map();
    for (const application of applications) {
      const key = scopeKey(application);
      const values = groups.get(key) || [];
      values.push(application);
      groups.set(key, values);
    }
    return Promise.all([...groups.values()].map(async scopedApplications => {
      const results = [];
      for (const application of scopedApplications) {
        const result = await this.collectApplication(application.id, { trigger: 'scheduled' });
        if (!result.skipped) results.push(result);
      }
      return results;
    }));
  }

  async collectApplication(applicationId, { trigger = 'manual' } = {}) {
    const application = this.database.getApplication(applicationId);
    if (!application) throw Object.assign(new Error('Application not found'), { statusCode: 404 });
    const key = scopeKey(application);
    if (this.activeScopes.has(key)) return { skipped: true, reason: 'collection_in_progress' };
    this.activeScopes.add(key);
    const runId = this.database.startCollectionRun({
      applicationId,
      profileId: application.profileId,
      region: application.region,
      trigger,
    });

    let requestCount = 0;
    let backlog = false;
    let status = 'completed';
    let errorCode = null;
    let errorMessage = null;
    const resources = this.database.listResources(applicationId, { enabledOnly: true });
    const results = [];

    try {
      for (const resource of resources) {
        try {
          const result = resource.type === 'lambda'
            ? await this.awsCollector.collect({ application, resource })
            : resource.type === 'kubernetes'
              ? await this.kubeCollector.collect({ application, resource })
              : this.awsMetricCollector?.supports(resource)
                ? await this.awsMetricCollector.collect({ application, resource })
                : { status: 'topology_only', requests: 0, backlog: false };
          results.push({ resourceId: resource.id, ...result });
          requestCount += Number(result.requests) || 0;
          backlog ||= !!result.backlog;
          if (result.status === 'budget_exhausted') status = 'budget_exhausted';
          else if (result.status === 'partial' && status === 'completed') status = 'partial';
          errorCode ||= result.errorCode || null;
          errorMessage ||= result.errorMessage || null;
        } catch (error) {
          const resourceErrorCode = collectionErrorCode(error);
          const resourceRequests = Number(error.apmRequestCount) || 0;
          requestCount += resourceRequests;
          results.push({
            resourceId: resource.id,
            status: 'failed',
            errorCode: resourceErrorCode,
            requests: resourceRequests,
          });
          if (status !== 'budget_exhausted') status = 'partial';
          errorCode ||= resourceErrorCode;
          errorMessage ||= error.message;
        }
      }
    } catch (error) {
      status = 'failed';
      errorCode = error.name || 'collection_failed';
      errorMessage = error.message;
    } finally {
      this.database.finishCollectionRun(runId, {
        status,
        requestCount,
        backlog,
        errorCode,
        errorMessage,
      });
      this.activeScopes.delete(key);
    }

    return {
      skipped: false,
      run: this.database.getCollectionRun(runId),
      resources: results,
    };
  }
}

module.exports = {
  ApmScheduler,
  POLL_INTERVAL_MS,
  collectionErrorCode,
  scopeKey,
};