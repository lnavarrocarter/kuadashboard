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

// The ARN of a resource a task names (Glue job, DynamoDB table) in the region and account of
// its state machine, when they are known.
function arnIn(context, service, resource) {
  return context?.region && context?.account ? `arn:aws:${service}:${context.region}:${context.account}:${resource}` : '';
}

function classifyReference(resource, parameters = {}, context = null) {
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
  // Glue jobs (#283): states:::glue:startJobRun and its .sync variant.
  if (direct.includes('states:::glue:startJobRun')) {
    const job = staticValue(parameters.JobName);
    return job ? { type: 'glue', arn: arnIn(context, 'glue', `job/${job}`), name: job, relationType: 'runs_job' } : null;
  }
  // DynamoDB items, optimized or through the AWS SDK integration (#283).
  if (/states:::(dynamodb|aws-sdk:dynamodb):/.test(direct)) {
    const table = staticValue(parameters.TableName);
    if (!table) return null;
    const arn = table.startsWith('arn:') ? table : arnIn(context, 'dynamodb', `table/${table}`);
    return { type: 'dynamodb', arn, name: lastArnSegment(table), relationType: 'accesses' };
  }
  // SNS publish (#283).
  if (direct.includes('states:::sns:publish')) {
    const arn = staticValue(parameters.TopicArn);
    return arn ? { type: 'sns', arn, name: lastArnSegment(arn), relationType: 'publishes_to' } : null;
  }
  if (/states:::aws-sdk:s3:(getObject|putObject|copyObject|deleteObject)/.test(direct)) {
    const bucket = staticValue(parameters.Bucket);
    return bucket ? { type: 's3', arn: bucket, name: bucket, relationType: 'accesses' } : null;
  }
  return null;
}

function collectStates(states, path, references, context) {
  for (const [stateName, state] of Object.entries(states || {})) {
    const statePath = path ? `${path} / ${stateName}` : stateName;
    if (state?.Type === 'Task') {
      const reference = classifyReference(state.Resource, state.Parameters || state.Arguments || {}, context);
      if (reference) references.push({ ...reference, statePath, integration: String(state.Resource || '') });
    }
    collectStates(state?.Iterator?.States, `${statePath} / Iterator`, references, context);
    collectStates(state?.ItemProcessor?.States, `${statePath} / ItemProcessor`, references, context);
    for (const [index, branch] of (state?.Branches || []).entries()) {
      collectStates(branch?.States, `${statePath} / Branch ${index + 1}`, references, context);
    }
  }
}

/**
 * The resources a state machine definition names. `context` ({ region, account }, usually from the
 * state machine ARN) builds the ARN of Glue jobs and DynamoDB tables named only by their name.
 */
function extractAslReferences(definition, context = null) {
  let parsed = definition;
  if (typeof definition === 'string') {
    try { parsed = JSON.parse(definition); } catch (_) { return []; }
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const references = [];
  collectStates(parsed.States, '', references, context);
  return references;
}

/** { region, account } of an ARN (empty when it is not one). */
function arnContext(arn) {
  const parts = String(arn || '').split(':');
  return parts[0] === 'arn' ? { region: parts[3] || '', account: parts[4] || '' } : {};
}

module.exports = { classifyReference, extractAslReferences, arnContext, lambdaName, lastArnSegment };