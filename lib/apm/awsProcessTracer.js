'use strict';

const {
  SFNClient, ListExecutionsCommand, DescribeExecutionCommand, GetExecutionHistoryCommand,
} = require('@aws-sdk/client-sfn');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { executionTimeline, matchingPaths, parseJson, payloadShape, sanitizePayload } = require('./processTrace');

const MAX_EXECUTIONS_PER_FLOW = 10;

function baseStateMachineArn(arn = '') {
  const [prefix, identity] = String(arn).split(':stateMachine:');
  if (!prefix || !identity) return '';
  return `${prefix}:stateMachine:${identity.split(':')[0]}`;
}

function associatedFlow(flows, arn) {
  const baseArn = baseStateMachineArn(arn);
  return flows.find(flow => baseStateMachineArn(flow.arn) === baseArn);
}

function createAwsProcessTracer({
  configResolver = resolveAwsConfig,
  clientFactory = config => new SFNClient(config),
} = {}) {
  return {
    async trace({ application, resources, requestId, executionArn, stateMachineArn, includeData = false, database }) {
      const query = String(requestId || '').trim();
      if (!executionArn && !stateMachineArn && (query.length < 4 || query.length > 200)) {
        throw Object.assign(new Error('requestId must contain between 4 and 200 characters'), { statusCode: 400 });
      }
      const client = clientFactory({ ...await configResolver(application.profileId), region: application.region });
      const flows = resources.filter(resource => resource.type === 'stepfunctions' && resource.enabled && resource.arn);
      const candidates = [];
      let availableExecutions = [];
      let requests = 0;
      let inspectedExecutions = 0;
      async function send(command) {
        const operation = command.constructor.name.replace(/Command$/, '');
        const reservation = database?.reserveAwsRequests({
          profileId: application.profileId, region: application.region, operation,
        });
        if (reservation && !reservation.allowed) {
          throw Object.assign(new Error('AWS request budget exhausted'), { statusCode: 429, code: 'budget_exhausted' });
        }
        requests += 1;
        return client.send(command);
      }
      if (executionArn) {
        const execution = await send(new DescribeExecutionCommand({ executionArn }));
        inspectedExecutions += 1;
        if (!associatedFlow(flows, execution.stateMachineArn)) {
          throw Object.assign(new Error('Execution does not belong to an associated Step Function'), { statusCode: 404 });
        }
        candidates.push(execution);
      } else if (stateMachineArn) {
        const flow = associatedFlow(flows, stateMachineArn);
        if (!flow) throw Object.assign(new Error('Step Function is not associated with this application'), { statusCode: 404 });
        const listed = await send(new ListExecutionsCommand({ stateMachineArn, maxResults: MAX_EXECUTIONS_PER_FLOW }));
        availableExecutions = (listed.executions || []).map(execution => ({
          executionArn: execution.executionArn,
          name: execution.name,
          status: execution.status,
          startDate: execution.startDate,
          stopDate: execution.stopDate || null,
        }));
        const latest = listed.executions?.[0];
        if (latest) {
          candidates.push(await send(new DescribeExecutionCommand({ executionArn: latest.executionArn })));
          inspectedExecutions += 1;
        }
      } else {
        for (const flow of flows) {
          const listed = await send(new ListExecutionsCommand({ stateMachineArn: flow.arn, maxResults: MAX_EXECUTIONS_PER_FLOW }));
          for (const summary of listed.executions || []) {
            const execution = await send(new DescribeExecutionCommand({ executionArn: summary.executionArn }));
            inspectedExecutions += 1;
            const input = parseJson(execution.input);
            const output = parseJson(execution.output);
            const paths = [...matchingPaths(input, query), ...matchingPaths(output, query).map(path => `output:${path}`)];
            if (paths.length) candidates.push({ ...execution, matchPaths: paths });
          }
        }
      }
      const traces = [];
      for (const execution of candidates.slice(0, 10)) {
        const history = await send(new GetExecutionHistoryCommand({
          executionArn: execution.executionArn, maxResults: 1000, includeExecutionData: includeData,
        }));
        const input = parseJson(execution.input);
        const output = parseJson(execution.output);
        traces.push({
          executionArn: execution.executionArn,
          name: execution.name || execution.executionArn?.split(':').pop(),
          stateMachineArn: execution.stateMachineArn,
          status: execution.status,
          startDate: execution.startDate,
          stopDate: execution.stopDate || null,
          durationMs: execution.stopDate && execution.startDate ? new Date(execution.stopDate) - new Date(execution.startDate) : null,
          matchPaths: execution.matchPaths || (query ? matchingPaths(input, query) : []),
          inputShape: payloadShape(input),
          ...(includeData ? {
            request: sanitizePayload(input),
            response: sanitizePayload(output),
          } : {}),
          timeline: executionTimeline(history.events || [], { includeData }),
        });
      }
      return {
        requests,
        searchedFlows: executionArn || stateMachineArn ? null : flows.length,
        inspectedExecutions,
        availableExecutions,
        dataIncluded: includeData,
        traces,
      };
    },
  };
}

module.exports = { MAX_EXECUTIONS_PER_FLOW, associatedFlow, baseStateMachineArn, createAwsProcessTracer };