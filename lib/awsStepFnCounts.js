'use strict';

// Execution counters for the Step Functions table. Each status is read on its
// own and reports what it really knows: a count, a count capped at one page
// (truncated), or the error that prevented reading it. A failed read is never
// turned into zero, so missing permissions cannot look like "no failures".
//
// ListExecutions only covers Standard workflows (Step Functions keeps their
// closed executions for 90 days); Express workflows are not supported by it.

const { classifyAwsError } = require('./awsAccess');

const PAGE_LIMIT = 1000; // ListExecutions maximum per page
const STATUSES = { running: 'RUNNING', failed: 'FAILED', timedOut: 'TIMED_OUT' };

/**
 * @param {(input: object) => Promise<{executions?: object[], nextToken?: string}>} listExecutions
 * @param {string} stateMachineArn
 * @returns {Promise<{limit: number, running: object, failed: object, timedOut: object}>}
 *   each status is `{ count, truncated }` or `{ error: { kind, message, action? } }`.
 */
async function countExecutions(listExecutions, stateMachineArn) {
  const keys = Object.keys(STATUSES);
  const results = await Promise.allSettled(keys.map(key =>
    listExecutions({ stateMachineArn, statusFilter: STATUSES[key], maxResults: PAGE_LIMIT })));
  const counts = { limit: PAGE_LIMIT };
  keys.forEach((key, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') {
      counts[key] = { count: result.value?.executions?.length || 0, truncated: Boolean(result.value?.nextToken) };
    } else {
      const { kind, message, action } = classifyAwsError(result.reason);
      counts[key] = { error: action ? { kind, message, action } : { kind, message } };
    }
  });
  return counts;
}

module.exports = { countExecutions, PAGE_LIMIT };
