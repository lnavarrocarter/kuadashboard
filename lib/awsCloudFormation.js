'use strict';
/**
 * lib/awsCloudFormation.js
 * Read-only CloudFormation view: stacks with status groups and drift, stack
 * detail (parameters, outputs, resources linked to KUA tabs), events with the
 * root cause of the last failure, template, and on-demand drift detection.
 * CloudFormation read APIs (Describe*, List*, GetTemplate, DetectStackDrift)
 * have no charge.
 *
 * Mutations follow the control rules of docs/architecture/provisioning-and-control-plan.md:
 * every change has a preview first (a change set for updates, a delete preview
 * for deletion), executing requires explicit confirmation in the route, and
 * every operation is written to the audit log by the route.
 */

const MAX_STACK_PAGES = 20;
const MAX_RESOURCE_PAGES = 20;
const MAX_EVENT_PAGES = 5;
const MAX_TEMPLATE_BYTES = 1024 * 1024;

// Stack names, or ARNs (nested stacks are referenced by ARN).
const STACK_REF_RE = /^(?:[A-Za-z][A-Za-z0-9-]{0,127}|arn:aws[a-z-]*:cloudformation:[a-z0-9-]+:\d{12}:stack\/[A-Za-z][A-Za-z0-9-]{0,127}\/[0-9a-f-]{36})$/;

// CloudFormation resource type → KUA tab that shows it.
const KUA_TABS = {
  'AWS::Lambda::Function': 'lambda',
  'AWS::SQS::Queue': 'sqs',
  'AWS::SNS::Topic': 'sns',
  'AWS::S3::Bucket': 's3',
  'AWS::DynamoDB::Table': 'dynamodb',
  'AWS::StepFunctions::StateMachine': 'stepfn',
  'AWS::ApiGateway::RestApi': 'apigw',
  'AWS::ApiGatewayV2::Api': 'apigw',
  'AWS::ECS::Service': 'ecs',
  'AWS::ECS::Cluster': 'ecs',
  'AWS::EC2::Instance': 'ec2',
  'AWS::EC2::VPC': 'vpc',
  'AWS::RDS::DBInstance': 'rds',
  'AWS::RDS::DBCluster': 'rds',
  'AWS::Logs::LogGroup': 'cwlogs',
  'AWS::Events::Rule': 'eventbridge',
  'AWS::CloudFront::Distribution': 'cloudfront',
  'AWS::SecretsManager::Secret': 'secrets',
  'AWS::ECR::Repository': 'ecr',
  'AWS::EKS::Cluster': 'eks',
  'AWS::Cognito::UserPool': 'cognito',
  'AWS::Route53::HostedZone': 'route53',
  'AWS::Glue::Job': 'glue',
  'AWS::SES::ConfigurationSet': 'ses',
  'AWS::CloudWatch::Dashboard': 'cwdashboards',
  'AWS::CloudFormation::Stack': 'cloudformation',
};

/** ok | progress | failed | rollback | review | deleted */
function statusGroup(status = '') {
  if (/^DELETE_COMPLETE$/.test(status)) return 'deleted';
  if (/ROLLBACK/.test(status)) return /IN_PROGRESS/.test(status) ? 'progress' : 'rollback';
  if (/FAILED$/.test(status)) return 'failed';
  if (/IN_PROGRESS$/.test(status)) return status === 'REVIEW_IN_PROGRESS' ? 'review' : 'progress';
  return 'ok';
}

function stackName(stack) {
  return stack.StackName || String(stack.StackId || '').split('/')[1] || '';
}

function normalizeStack(stack) {
  const drift = stack.DriftInformation || {};
  return {
    id: stack.StackId,
    name: stackName(stack),
    status: stack.StackStatus,
    statusGroup: statusGroup(stack.StackStatus),
    statusReason: stack.StackStatusReason || null,
    description: stack.Description || null,
    createdTime: stack.CreationTime || null,
    updatedTime: stack.LastUpdatedTime || null,
    drift: { status: drift.StackDriftStatus || 'NOT_CHECKED', checkedAt: drift.LastCheckTimestamp || null },
    terminationProtection: !!stack.EnableTerminationProtection,
    parentId: stack.ParentId || null,
    rootId: stack.RootId || null,
    roleArn: stack.RoleARN || null,
    capabilities: stack.Capabilities || [],
    // NoEcho parameters already come masked (****) from CloudFormation.
    parameters: (stack.Parameters || []).map(p => ({ key: p.ParameterKey, value: p.ResolvedValue ?? p.ParameterValue ?? '', resolvedFrom: p.ResolvedValue ? p.ParameterValue : null })),
    outputs: (stack.Outputs || []).map(o => ({ key: o.OutputKey, value: o.OutputValue, description: o.Description || null, exportName: o.ExportName || null })),
    tags: Object.fromEntries((stack.Tags || []).map(t => [t.Key, t.Value])),
    isAgentCore: /agent\s*core|agentcore/i.test(stackName(stack)),
  };
}

async function paginate(send, input, key, maxPages) {
  const items = [];
  let NextToken;
  let pages = 0;
  do {
    const response = await send({ ...input, NextToken });
    items.push(...(response[key] || []));
    NextToken = response.NextToken;
    pages += 1;
  } while (NextToken && pages < maxPages);
  return { items, truncated: !!NextToken };
}

/** Every stack that exists (DescribeStacks omits deleted ones), with detail. */
async function listStacks(client, { DescribeStacksCommand }) {
  const { items, truncated } = await paginate(input => client.send(new DescribeStacksCommand(input)), {}, 'Stacks', MAX_STACK_PAGES);
  const stacks = items.map(normalizeStack);
  const counts = {};
  for (const stack of stacks) counts[stack.statusGroup] = (counts[stack.statusGroup] || 0) + 1;
  return { stacks, counts, truncated };
}

function normalizeResource(resource) {
  return {
    logicalId: resource.LogicalResourceId,
    physicalId: resource.PhysicalResourceId || null,
    type: resource.ResourceType,
    status: resource.ResourceStatus,
    statusGroup: statusGroup(resource.ResourceStatus),
    statusReason: resource.ResourceStatusReason || null,
    updatedTime: resource.LastUpdatedTimestamp || null,
    drift: resource.DriftInformation?.StackResourceDriftStatus || 'NOT_CHECKED',
    kuaTab: KUA_TABS[resource.ResourceType] || null,
    // Name to search for in the KUA tab (physical ids are names, URLs or ARNs).
    kuaName: resource.PhysicalResourceId ? String(resource.PhysicalResourceId).split(/[/:]/).filter(Boolean).pop() : null,
  };
}

async function stackDetail(client, { DescribeStacksCommand, ListStackResourcesCommand }, stackRef) {
  const described = await client.send(new DescribeStacksCommand({ StackName: stackRef }));
  const stack = described.Stacks?.[0];
  if (!stack) throw Object.assign(new Error('Stack not found'), { $metadata: { httpStatusCode: 404 } });
  const { items, truncated } = await paginate(input => client.send(new ListStackResourcesCommand(input)), { StackName: stack.StackId }, 'StackResourceSummaries', MAX_RESOURCE_PAGES);
  const resources = items.map(normalizeResource).sort((a, b) => a.type.localeCompare(b.type) || a.logicalId.localeCompare(b.logicalId));
  const byType = {};
  for (const resource of resources) byType[resource.type] = (byType[resource.type] || 0) + 1;
  return { stack: normalizeStack(stack), resources, resourcesTruncated: truncated, byType };
}

function normalizeEvent(event) {
  return {
    id: event.EventId,
    timestamp: event.Timestamp ? new Date(event.Timestamp).getTime() : null,
    logicalId: event.LogicalResourceId,
    physicalId: event.PhysicalResourceId || null,
    type: event.ResourceType,
    status: event.ResourceStatus,
    statusGroup: statusGroup(event.ResourceStatus),
    reason: event.ResourceStatusReason || null,
  };
}

/**
 * The failure that started the latest stack operation going wrong: the
 * earliest *_FAILED resource event after the operation began. Later failures
 * are usually cascades ("Resource creation cancelled", rollbacks).
 */
function rootCause(events, stackLogicalId) {
  const chronological = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let start = 0;
  chronological.forEach((event, index) => {
    if (event.type === 'AWS::CloudFormation::Stack' && event.logicalId === stackLogicalId && /_IN_PROGRESS$/.test(event.status) && !/ROLLBACK|CLEANUP/.test(event.status)) start = index;
  });
  const operation = chronological.slice(start);
  const failed = operation.find(event => /FAILED$/.test(event.status) && !(event.type === 'AWS::CloudFormation::Stack' && event.logicalId === stackLogicalId) && !/cancelled/i.test(event.reason || ''));
  return failed || operation.find(event => /FAILED$/.test(event.status)) || null;
}

async function stackEvents(client, { DescribeStackEventsCommand }, stackRef, { stackName: name = stackRef } = {}) {
  const { items, truncated } = await paginate(input => client.send(new DescribeStackEventsCommand(input)), { StackName: stackRef }, 'StackEvents', MAX_EVENT_PAGES);
  const events = items.map(normalizeEvent).sort((a, b) => b.timestamp - a.timestamp);
  return { events, truncated, rootCause: rootCause(events, name) };
}

async function stackTemplate(client, { GetTemplateCommand }, stackRef) {
  const response = await client.send(new GetTemplateCommand({ StackName: stackRef, TemplateStage: 'Original' }));
  const body = typeof response.TemplateBody === 'string' ? response.TemplateBody : JSON.stringify(response.TemplateBody ?? '', null, 2);
  const format = body.trim().startsWith('{') ? 'json' : 'yaml';
  return { body: body.slice(0, MAX_TEMPLATE_BYTES), truncated: body.length > MAX_TEMPLATE_BYTES, format, bytes: Buffer.byteLength(body) };
}

async function startDriftDetection(client, { DetectStackDriftCommand }, stackRef) {
  const response = await client.send(new DetectStackDriftCommand({ StackName: stackRef }));
  return { detectionId: response.StackDriftDetectionId };
}

/** Detection status and, when finished, the resources that drifted with their property differences. */
async function driftResult(client, { DescribeStackDriftDetectionStatusCommand, DescribeStackResourceDriftsCommand }, stackRef, detectionId) {
  const status = await client.send(new DescribeStackDriftDetectionStatusCommand({ StackDriftDetectionId: detectionId }));
  const result = {
    detectionStatus: status.DetectionStatus,
    detectionStatusReason: status.DetectionStatusReason || null,
    stackDriftStatus: status.StackDriftStatus || null,
    driftedResources: status.DriftedStackResourceCount ?? null,
    checkedAt: status.Timestamp || null,
    resources: [],
  };
  if (status.DetectionStatus === 'DETECTION_IN_PROGRESS') return result;
  const { items } = await paginate(
    input => client.send(new DescribeStackResourceDriftsCommand(input)),
    { StackName: stackRef, StackResourceDriftStatusFilters: ['MODIFIED', 'DELETED'] },
    'StackResourceDrifts', 5,
  );
  result.resources = items.map(drift => ({
    logicalId: drift.LogicalResourceId,
    physicalId: drift.PhysicalResourceId || null,
    type: drift.ResourceType,
    status: drift.StackResourceDriftStatus,
    differences: (drift.PropertyDifferences || []).map(d => ({ path: d.PropertyPath, expected: d.ExpectedValue, actual: d.ActualValue, type: d.DifferenceType })),
  }));
  return result;
}

// ─── Exports and imports ──────────────────────────────────────────────────────

const MAX_IMPORT_LOOKUPS = 100;

/** Every export of the region and the stacks that import it (one ListImports call per export, capped). */
async function listExports(client, { ListExportsCommand, ListImportsCommand }) {
  const { items, truncated } = await paginate(input => client.send(new ListExportsCommand(input)), {}, 'Exports', 10);
  const exports = items.map(e => ({ name: e.Name, value: e.Value, exportingStackId: e.ExportingStackId, exportingStack: String(e.ExportingStackId || '').split('/')[1] || null, importedBy: [] }));
  const lookups = exports.slice(0, MAX_IMPORT_LOOKUPS);
  await Promise.all(lookups.map(async item => {
    try {
      const { items: imports } = await paginate(input => client.send(new ListImportsCommand({ ...input, ExportName: item.name })), {}, 'Imports', 5);
      item.importedBy = imports;
    } catch (err) {
      // CloudFormation answers "not imported by any stack" with a ValidationError.
      if (!/not imported/i.test(err.message || '')) item.importError = err.message;
    }
  }));
  return { exports, truncated, importsChecked: lookups.length };
}

// ─── Change sets ──────────────────────────────────────────────────────────────

// Resource types whose replacement or removal can lose data.
const DATA_BEARING = new Set([
  'AWS::DynamoDB::Table', 'AWS::DynamoDB::GlobalTable', 'AWS::RDS::DBInstance', 'AWS::RDS::DBCluster', 'AWS::S3::Bucket',
  'AWS::EFS::FileSystem', 'AWS::ElastiCache::CacheCluster', 'AWS::ElastiCache::ReplicationGroup', 'AWS::Elasticsearch::Domain',
  'AWS::OpenSearchService::Domain', 'AWS::SQS::Queue', 'AWS::Kinesis::Stream', 'AWS::Logs::LogGroup', 'AWS::SecretsManager::Secret',
  'AWS::Cognito::UserPool', 'AWS::DocDB::DBCluster', 'AWS::Neptune::DBCluster', 'AWS::Redshift::Cluster', 'AWS::EC2::Volume',
]);

function normalizeChangeSetSummary(cs) {
  return {
    id: cs.ChangeSetId, name: cs.ChangeSetName, status: cs.Status, statusReason: cs.StatusReason || null,
    executionStatus: cs.ExecutionStatus, createdTime: cs.CreationTime || null, description: cs.Description || null,
    includesNestedStacks: !!cs.IncludeNestedStacks,
  };
}

async function listChangeSets(client, { ListChangeSetsCommand }, stackRef) {
  const { items } = await paginate(input => client.send(new ListChangeSetsCommand({ ...input, StackName: stackRef })), {}, 'Summaries', 5);
  return items.map(normalizeChangeSetSummary).sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
}

function normalizeChange(change) {
  const rc = change.ResourceChange || {};
  const replacement = rc.Replacement || null; // True | False | Conditional
  return {
    action: rc.Action, // Add | Modify | Remove | Import | Dynamic
    logicalId: rc.LogicalResourceId,
    physicalId: rc.PhysicalResourceId || null,
    type: rc.ResourceType,
    replacement,
    scope: rc.Scope || [],
    dataBearing: DATA_BEARING.has(rc.ResourceType),
    details: (rc.Details || []).map(d => ({
      attribute: d.Target?.Attribute || null, name: d.Target?.Name || null,
      requiresRecreation: d.Target?.RequiresRecreation || null,
      evaluation: d.Evaluation || null, changeSource: d.ChangeSource || null, causingEntity: d.CausingEntity || null,
    })),
  };
}

/**
 * Risk of executing a set of changes:
 *  high   → data-bearing resources removed or replaced
 *  medium → any removal or replacement (True/Conditional)
 *  low    → additions and in-place modifications only
 */
function changeRisk(changes) {
  const destructive = changes.filter(c => c.action === 'Remove' || c.replacement === 'True' || c.replacement === 'Conditional');
  const dataLoss = destructive.filter(c => c.dataBearing);
  return {
    level: dataLoss.length ? 'high' : destructive.length ? 'medium' : 'low',
    removals: changes.filter(c => c.action === 'Remove').length,
    replacements: changes.filter(c => c.replacement === 'True').length,
    conditionalReplacements: changes.filter(c => c.replacement === 'Conditional').length,
    dataBearing: dataLoss.map(c => c.logicalId),
    counts: changes.reduce((acc, c) => ({ ...acc, [c.action]: (acc[c.action] || 0) + 1 }), {}),
  };
}

async function describeChangeSet(client, { DescribeChangeSetCommand }, stackRef, changeSet) {
  const changes = [];
  let first = null;
  let NextToken;
  let pages = 0;
  do {
    const response = await client.send(new DescribeChangeSetCommand({ StackName: stackRef, ChangeSetName: changeSet, NextToken }));
    first = first || response;
    changes.push(...(response.Changes || []).map(normalizeChange));
    NextToken = response.NextToken;
    pages += 1;
  } while (NextToken && pages < 10);
  return {
    ...normalizeChangeSetSummary(first),
    parameters: (first.Parameters || []).map(p => ({ key: p.ParameterKey, value: p.ParameterValue ?? null, usePrevious: !!p.UsePreviousValue })),
    capabilities: first.Capabilities || [],
    changes,
    risk: changeRisk(changes),
  };
}

/**
 * Preview of a parameter update: a change set on the current template with the
 * given parameter values (others keep their previous value). Nothing changes
 * until the change set is executed.
 */
async function createParameterChangeSet(client, { DescribeStacksCommand, CreateChangeSetCommand }, stackRef, parameters = {}, { now = Date.now() } = {}) {
  const described = await client.send(new DescribeStacksCommand({ StackName: stackRef }));
  const stack = described.Stacks?.[0];
  if (!stack) throw Object.assign(new Error('Stack not found'), { $metadata: { httpStatusCode: 404 } });
  const known = new Set((stack.Parameters || []).map(p => p.ParameterKey));
  const unknown = Object.keys(parameters).filter(key => !known.has(key));
  if (unknown.length) throw Object.assign(new Error(`Unknown parameter(s): ${unknown.join(', ')}`), { $metadata: { httpStatusCode: 400 } });
  const changeSetName = `kua-${new Date(now).toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  const response = await client.send(new CreateChangeSetCommand({
    StackName: stack.StackId,
    ChangeSetName: changeSetName,
    ChangeSetType: 'UPDATE',
    UsePreviousTemplate: true,
    Description: 'Parameter update previewed from KUA',
    Capabilities: stack.Capabilities || [],
    Parameters: (stack.Parameters || []).map(p => (Object.prototype.hasOwnProperty.call(parameters, p.ParameterKey)
      ? { ParameterKey: p.ParameterKey, ParameterValue: String(parameters[p.ParameterKey]) }
      : { ParameterKey: p.ParameterKey, UsePreviousValue: true })),
    Tags: [...(stack.Tags || []).filter(t => !t.Key.startsWith('aws:'))],
  }));
  return { changeSetId: response.Id, changeSetName, stackId: stack.StackId };
}

async function executeChangeSet(client, { ExecuteChangeSetCommand }, stackRef, changeSet) {
  await client.send(new ExecuteChangeSetCommand({ StackName: stackRef, ChangeSetName: changeSet }));
  return { executed: true };
}

async function deleteChangeSet(client, { DeleteChangeSetCommand }, stackRef, changeSet) {
  await client.send(new DeleteChangeSetCommand({ StackName: stackRef, ChangeSetName: changeSet }));
  return { deleted: true };
}

// ─── Stack operations ────────────────────────────────────────────────────────

async function setTerminationProtection(client, { UpdateTerminationProtectionCommand }, stackRef, enabled) {
  await client.send(new UpdateTerminationProtectionCommand({ StackName: stackRef, EnableTerminationProtection: !!enabled }));
  return { terminationProtection: !!enabled };
}

// CloudFormation intrinsic tags (!Ref, !Sub…) so YAML templates parse; values are kept as plain data.
const CFN_TAGS = ['Ref', 'Condition', 'Base64', 'Cidr', 'FindInMap', 'GetAtt', 'GetAZs', 'ImportValue', 'Join', 'Select', 'Split', 'Sub', 'Transform', 'And', 'Equals', 'If', 'Not', 'Or'];
let cfnSchema = null;
function parseTemplate(body, format) {
  if (format === 'json') return JSON.parse(body);
  const yaml = require('js-yaml');
  if (!cfnSchema) {
    cfnSchema = yaml.DEFAULT_SCHEMA.extend(CFN_TAGS.flatMap(tag => ['scalar', 'sequence', 'mapping'].map(kind =>
      new yaml.Type(`!${tag}`, { kind, construct: data => ({ [tag === 'Ref' || tag === 'Condition' ? tag : `Fn::${tag}`]: data }) }))));
  }
  return yaml.load(body, { schema: cfnSchema });
}

/** DeletionPolicy per logical id (Retain / Snapshot / RetainExceptOnCreate), from the template. */
function deletionPolicies(template) {
  const policies = {};
  for (const [logicalId, resource] of Object.entries(template?.Resources || {})) {
    if (resource?.DeletionPolicy && resource.DeletionPolicy !== 'Delete') policies[logicalId] = resource.DeletionPolicy;
  }
  return policies;
}

/**
 * What deleting a stack would do, before doing it: resources removed vs kept
 * (DeletionPolicy), data-bearing resources removed, nested stacks, exports
 * other stacks import (CloudFormation refuses the delete), and termination
 * protection (must be off).
 */
async function deletePreview(client, commands, stackRef) {
  const detail = await stackDetail(client, commands, stackRef);
  let policies = {};
  let templateError = null;
  try {
    const template = await stackTemplate(client, commands, detail.stack.id);
    policies = deletionPolicies(parseTemplate(template.body, template.format));
  } catch (err) { templateError = err.message; }
  const exportNames = detail.stack.outputs.map(o => o.exportName).filter(Boolean);
  const blockingImports = [];
  for (const name of exportNames) {
    try {
      const { items } = await paginate(input => client.send(new commands.ListImportsCommand({ ...input, ExportName: name })), {}, 'Imports', 3);
      if (items.length) blockingImports.push({ exportName: name, importedBy: items });
    } catch (err) {
      if (!/not imported/i.test(err.message || '')) blockingImports.push({ exportName: name, error: err.message });
    }
  }
  const resources = detail.resources.map(r => ({ ...r, deletionPolicy: policies[r.logicalId] || 'Delete', dataBearing: DATA_BEARING.has(r.type) }));
  const removed = resources.filter(r => r.deletionPolicy === 'Delete');
  const blockers = [];
  if (detail.stack.terminationProtection) blockers.push('termination_protection');
  if (blockingImports.some(i => i.importedBy?.length)) blockers.push('exports_imported');
  if (detail.stack.parentId) blockers.push('nested_stack');
  if (/_IN_PROGRESS$/.test(detail.stack.status)) blockers.push('in_progress');
  return {
    stack: { id: detail.stack.id, name: detail.stack.name, status: detail.stack.status, terminationProtection: detail.stack.terminationProtection },
    resources,
    summary: {
      total: resources.length,
      removed: removed.length,
      retained: resources.length - removed.length,
      dataBearingRemoved: removed.filter(r => r.dataBearing).map(r => r.logicalId),
      nestedStacks: resources.filter(r => r.type === 'AWS::CloudFormation::Stack').length,
    },
    blockingImports, blockers, templateError,
    risk: removed.some(r => r.dataBearing) ? 'high' : removed.length ? 'medium' : 'low',
  };
}

async function deleteStack(client, { DeleteStackCommand }, stackRef) {
  await client.send(new DeleteStackCommand({ StackName: stackRef }));
  return { deleting: true };
}

module.exports = {
  STACK_REF_RE, KUA_TABS, DATA_BEARING, statusGroup, normalizeStack, normalizeResource, rootCause, changeRisk, parseTemplate, deletionPolicies,
  listStacks, stackDetail, stackEvents, stackTemplate, startDriftDetection, driftResult,
  listExports, listChangeSets, describeChangeSet, createParameterChangeSet, executeChangeSet, deleteChangeSet,
  setTerminationProtection, deletePreview, deleteStack,
};
