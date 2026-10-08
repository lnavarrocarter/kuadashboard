'use strict';

const { runWithUsageContext } = require('../usage/awsMeter');
const { applicationForResource, PROVIDER_LESS_PROFILE } = require('../kua/scopeCredentials');

const POLL_INTERVAL_MS = 30 * 60 * 1000;

function scopeKey(application) {
  // An application without a provider reaches each resource through its own scope (#166).
  if (!application.profileId) return `kuapp\u0000${application.id}`;
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
    taskRegistry = null,
    intervalMs = POLL_INTERVAL_MS,
    timers = { setInterval, clearInterval },
    logger = console,
  }) {
    if (!database || !awsCollector || !kubeCollector) throw new Error('database and collectors are required');
    this.database = database;
    this.awsCollector = awsCollector;
    this.kubeCollector = kubeCollector;
    this.awsMetricCollector = awsMetricCollector;
    this.taskRegistry = taskRegistry;
    this.intervalMs = intervalMs;
    this.timers = timers;
    this.logger = logger;
    this.activeScopes = new Set();
    this.applicationTasks = new Map();
    this.timer = null;
  }

  start({ task = null } = {}) {
    if (this.timer) return;
    if (task) this.task = task;
    this.timer = this.timers.setInterval(() => {
      const run = this.task ? this.task.run(() => this.runScheduled()) : this.runScheduled();
      run.catch(error => this.logger.error('[apm] Scheduled collection failed:', error.message));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  pause() {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  resume() {
    this.start({ task: this.task });
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
    this.task?.setDetail(applications.map(application => application.name || application.id).join(', '));
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

  async collectApplication(applicationId, options = {}) {
    const application = this.database.getApplication(applicationId);
    if (!application) throw Object.assign(new Error('Application not found'), { statusCode: 404 });
    const task = this.applicationTask(application);
    const collect = () => runWithUsageContext(
      { profileId: application.profileId, feature: 'observability' },
      () => this.collectApplicationNow(application, { ...options, task }),
    );
    const result = task ? await task.run(collect) : await collect();
    if (task && result?.run) {
      task.update({
        lastRunStatus: result.run.status,
        errorCode: result.run.errorCode || (result.run.status === 'budget_exhausted' ? 'budget_exhausted' : null),
        detail: `${application.name || application.id} · ${result.run.status}`,
      });
    }
    return result;
  }

  applicationTask(application) {
    if (!this.taskRegistry) return null;
    const current = this.applicationTasks.get(application.id);
    if (current) return current;
    const task = this.taskRegistry.register({
      id: `apm.collect.${application.id}`,
      name: application.name || application.id,
      type: 'collection',
      provider: application.provider || 'mixed',
      enabled: false,
    });
    this.applicationTasks.set(application.id, task);
    return task;
  }

  async collectApplicationNow(application, { trigger = 'manual', task = null } = {}) {
    const applicationId = application.id;
    const key = scopeKey(application);
    if (this.activeScopes.has(key)) return { skipped: true, reason: 'collection_in_progress' };
    this.activeScopes.add(key);
    const runId = this.database.startCollectionRun({
      applicationId,
      profileId: application.profileId || PROVIDER_LESS_PROFILE,
      region: application.region || '',
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
      for (const [index, resource] of resources.entries()) {
        task?.setDetail(`${application.name || applicationId} · ${resource.name || resource.id}`);
        try {
          // The profile and region that reach this resource: the application's own, or the
          // verified binding of the resource's scope for an application without a provider.
          const scoped = applicationForResource(this.database, application, resource);
          const result = await runWithUsageContext({ profileId: scoped.profileId }, () =>
            resource.type === 'lambda'
              ? this.awsCollector.collect({ application: scoped, resource })
              : resource.type === 'kubernetes'
                ? this.kubeCollector.collect({ application: scoped, resource })
                : this.awsMetricCollector?.supports(resource)
                  ? this.awsMetricCollector.collect({ application: scoped, resource })
                  : { status: 'topology_only', requests: 0, backlog: false });
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
        task?.setProgress((index + 1) / resources.length);
      }
    } catch (error) {
      status = 'failed';
      errorCode = error.name || 'collection_failed';
      errorMessage = error.message;
    } finally {
      task?.setDetail(`${application.name || applicationId} · ${status}`);
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