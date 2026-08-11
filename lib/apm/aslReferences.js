'use strict';

function lastArnSegment(value) {
  return String(value || '').split(/[:/]/).filter(Boolean).pop() || '';
}

function lambdaName(value) {
  const parts = String(value || '').split(':');
  const functionIndex = parts.indexOf('function');
  return functionIndex >= 0 ? parts[functionIndex + 1] || '' : lastArnSegment(value);
}

function staticValue(value) {
  return typeof value === 'string' && !value.includes('.$') && !value.startsWith('$') ? value : '';
}

function classifyReference(resource, parameters = {}) {
  const direct = staticValue(resource);
  if (/^arn:[^:]+:lambda:/.test(direct)) {
    return { type: 'lambda', arn: direct, name: lambdaName(direct), relationType: 'invokes' };
  }
  if (/^arn:[^:]+:states:[^:]+:[^:]+:stateMachine:/.test(direct)) {
    return { type: 'stepfunctions', arn: direct, name: lastArnSegment(direct), relationType: 'starts_execution' };
  }
  if (direct.includes('states:::lambda:invoke')) {
    const arn = staticValue(parameters.FunctionName);
    return arn ? { type: 'lambda', arn, name: lambdaName(arn), relationType: 'invokes' } : null;
  }
  if (direct.includes('states:::states:startExecution')) {
    const arn = staticValue(parameters.StateMachineArn);
    return arn ? { type: 'stepfunctions', arn, name: lastArnSegment(arn), relationType: 'starts_execution' } : null;
  }
  if (direct.includes('states:::sqs:sendMessage')) {
    const arn = staticValue(parameters.QueueUrl);
    return arn ? { type: 'sqs', arn, name: lastArnSegment(arn), relationType: 'sends_to' } : null;
  }
  if (direct.includes('states:::ecs:runTask')) {
    const arn = staticValue(parameters.Cluster) || staticValue(parameters.TaskDefinition);
    return arn ? { type: 'ecs', arn, name: lastArnSegment(arn), relationType: 'runs_task' } : null;
  }
  if (/states:::aws-sdk:s3:(getObject|putObject|copyObject|deleteObject)/.test(direct)) {
    const bucket = staticValue(parameters.Bucket);
    return bucket ? { type: 's3', arn: bucket, name: bucket, relationType: 'accesses' } : null;
  }
  return null;
}

function collectStates(states, path, references) {
  for (const [stateName, state] of Object.entries(states || {})) {
    const statePath = path ? `${path} / ${stateName}` : stateName;
    if (state?.Type === 'Task') {
      const reference = classifyReference(state.Resource, state.Parameters || state.Arguments || {});
      if (reference) references.push({ ...reference, statePath, integration: String(state.Resource || '') });
    }
    collectStates(state?.Iterator?.States, `${statePath} / Iterator`, references);
    collectStates(state?.ItemProcessor?.States, `${statePath} / ItemProcessor`, references);
    for (const [index, branch] of (state?.Branches || []).entries()) {
      collectStates(branch?.States, `${statePath} / Branch ${index + 1}`, references);
    }
  }
}

function extractAslReferences(definition) {
  let parsed = definition;
  if (typeof definition === 'string') {
    try { parsed = JSON.parse(definition); } catch (_) { return []; }
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const references = [];
  collectStates(parsed.States, '', references);
  return references;
}

module.exports = { classifyReference, extractAslReferences, lambdaName, lastArnSegment };