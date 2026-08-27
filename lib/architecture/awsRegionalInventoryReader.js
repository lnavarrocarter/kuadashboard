'use strict';

const { EventBridgeClient, ListEventBusesCommand, ListRulesCommand, ListTargetsByRuleCommand } = require('@aws-sdk/client-eventbridge');
const { LambdaClient, ListEventSourceMappingsCommand, ListFunctionsCommand } = require('@aws-sdk/client-lambda');
const { SFNClient, DescribeStateMachineCommand, ListStateMachinesCommand } = require('@aws-sdk/client-sfn');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { extractAslReferences, lastArnSegment } = require('../apm/aslReferences');

const MAX_RESOURCES = 500;

function accountFromArn(value) {
  return String(value || '').split(':')[4] || '';
}

function resourceIdentity(type, name, arn, service = '') {
  if (type === 'lambda') return `AWS::Lambda::Function:${name}`;
  if (type === 'eventbridge') return `AWS::Events::Rule:${service || 'default'}|${name}`;
  if (type === 'sqs') return `AWS::SQS::Queue:${name}`;
  if (type === 's3') return `AWS::S3::Bucket:${name}`;
  if (type === 'dynamodb') return `AWS::DynamoDB::Table:${name}`;
  if (type === 'sns') return `AWS::SNS::Topic:${name}`;
  return arn || `${type}:${name}`;
}

function resourceKind(type) {
  return {
    lambda: 'AWS::Lambda::Function',
    eventbridge: 'AWS::Events::Rule',
    stepfunctions: 'AWS::StepFunctions::StateMachine',
    sqs: 'AWS::SQS::Queue',
    ecs: 'AWS::ECS::Service',
    s3: 'AWS::S3::Bucket',
    dynamodb: 'AWS::DynamoDB::Table',
    sns: 'AWS::SNS::Topic',
  }[type] || 'AWS::Resource';
}

function inventoryResource({ type, name, arn = null, service = '' }) {
  const identity = resourceIdentity(type, name, arn, service);
  return {
    type,
    key: identity,
    identity,
    arn,
    name,
    service,
    kind: resourceKind(type),
    stackName: '',
    logicalId: '',
    sourceType: 'inventory',
    sourceName: 'regional-inventory',
  };
}

function referencedResource(reference) {
  if (!reference?.type || !reference?.name) return null;
  return inventoryResource(reference);
}

function createAwsRegionalInventoryReader({
  configResolver = resolveAwsConfig,
  lambdaFactory = config => new LambdaClient(config),
  eventBridgeFactory = config => new EventBridgeClient(config),
  sfnFactory = config => new SFNClient(config),
  beforeRequest = () => {},
} = {}) {
  async function analyze({ profileId, region }) {
    const config = { ...await configResolver(profileId), region };
    const lambda = lambdaFactory(config);
    const eventBridge = eventBridgeFactory(config);
    const sfn = sfnFactory(config);
    const resources = new Map();
    const relationships = new Map();
    const failures = [];
    let requests = 0;

    async function send(client, command) {
      beforeRequest({ profileId, region, operation: command.constructor.name.replace(/Command$/, '') });
      requests += 1;
      return client.send(command);
    }

    function addResource(resource) {
      if (!resource || resources.has(resource.identity) || resources.size >= MAX_RESOURCES) return;
      resources.set(resource.identity, resource);
    }

    function addRelationship(source, target, relationType, confidence, evidence) {
      if (!source || !target || source === target) return;
      const key = `${source}:${target}:${relationType}`;
      const current = relationships.get(key) || {
        sourceKey: source,
        targetKey: target,
        relationType,
        confidence,
        evidence: [],
      };
      current.evidence.push(evidence);
      relationships.set(key, current);
    }

    function addEnvironmentReferences(source, variables) {
      for (const [key, value] of Object.entries(variables || {})) {
        const reference = referenceFromEnvValue(value);
        if (!reference) continue;
        const target = referencedResource(reference);
        if (!target || target.identity === source.identity) continue;
        addResource(target);
        addRelationship(source.identity, target.identity, 'references', 0.6, {
          type: 'lambda_environment_variable',
          key,
          value: reference.arn || `${target.kind}:${target.name}`,
        });
      }
    }

    async function listLambdaFunctions() {
      let marker;
      do {
        const response = await send(lambda, new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
        for (const fn of response.Functions || []) {
          const source = inventoryResource({ type: 'lambda', name: fn.FunctionName, arn: fn.FunctionArn || null });
          addResource(source);
          addEnvironmentReferences(source, fn.Environment?.Variables);
        }
        marker = resources.size < MAX_RESOURCES ? response.NextMarker : null;
      } while (marker);

      marker = undefined;
      do {
        const response = await send(lambda, new ListEventSourceMappingsCommand({ Marker: marker, MaxItems: 100 }));
        for (const mapping of response.EventSourceMappings || []) {
          const sourceReference = referenceFromArn(mapping.EventSourceArn);
          const targetReference = referenceFromArn(mapping.FunctionArn);
          if (sourceReference?.type !== 'sqs' || targetReference?.type !== 'lambda') continue;
          const source = referencedResource(sourceReference);
          const target = referencedResource(targetReference);
          addResource(source);
          addResource(target);
          addRelationship(source.identity, target.identity, 'triggers', 0.99, {
            type: 'lambda_event_source_mapping',
            uuid: mapping.UUID || '',
            state: mapping.State || '',
            batchSize: mapping.BatchSize || null,
            eventSourceArn: mapping.EventSourceArn || '',
            functionArn: mapping.FunctionArn || '',
          });
        }
        marker = resources.size < MAX_RESOURCES ? response.NextMarker : null;
      } while (marker);
    }

    async function listEventBridgeRules() {
      let busToken;
      do {
        const busResponse = await send(eventBridge, new ListEventBusesCommand({ NextToken: busToken, Limit: 50 }));
        for (const bus of busResponse.EventBuses || []) {
          let ruleToken;
          do {
            const ruleResponse = await send(eventBridge, new ListRulesCommand({
              EventBusName: bus.Name,
              NextToken: ruleToken,
              Limit: 100,
            }));
            for (const rule of ruleResponse.Rules || []) {
              const source = inventoryResource({
                type: 'eventbridge', name: rule.Name, arn: rule.Arn || null, service: bus.Name,
              });
              addResource(source);
              if (!resources.has(source.identity)) break;
              let targetToken;
              do {
                const targetResponse = await send(eventBridge, new ListTargetsByRuleCommand({
                  EventBusName: bus.Name,
                  Rule: rule.Name,
                  NextToken: targetToken,
                  Limit: 100,
                }));
                for (const target of targetResponse.Targets || []) {
                  const reference = referenceFromArn(target.Arn);
                  const targetResource = referencedResource(reference);
                  addResource(targetResource);
                  addRelationship(source.identity, targetResource?.identity, 'triggers', 0.99, {
                    type: 'eventbridge_target',
                    rule: rule.Name,
                    eventBus: bus.Name,
                    description: rule.Description || '',
                    state: rule.State || '',
                    eventPattern: rule.EventPattern || '',
                    scheduleExpression: rule.ScheduleExpression || '',
                    targetId: target.Id || '',
                    targetArn: target.Arn || '',
                    input: target.Input || '',
                    inputPath: target.InputPath || '',
                    inputTransformer: target.InputTransformer || null,
                    retryPolicy: target.RetryPolicy || null,
                    deadLetterArn: target.DeadLetterConfig?.Arn || '',
                  });
                }
                targetToken = targetResponse.NextToken;
              } while (targetToken);
            }
            ruleToken = ruleResponse.NextToken;
          } while (ruleToken && resources.size < MAX_RESOURCES);
        }
        busToken = busResponse.NextToken;
      } while (busToken && resources.size < MAX_RESOURCES);
    }

    async function listStateMachines() {
      if (resources.size >= MAX_RESOURCES) return;
      let nextToken;
      do {
        const response = await send(sfn, new ListStateMachinesCommand({ nextToken, maxResults: 100 }));
        for (const stateMachine of response.stateMachines || []) {
          const source = inventoryResource({
            type: 'stepfunctions',
            name: stateMachine.name,
            arn: stateMachine.stateMachineArn,
          });
          addResource(source);
          if (!resources.has(source.identity)) break;
          const detail = await send(sfn, new DescribeStateMachineCommand({ stateMachineArn: stateMachine.stateMachineArn }));
          for (const reference of extractAslReferences(detail.definition)) {
            const target = referencedResource(reference);
            addResource(target);
            addRelationship(source.identity, target?.identity, reference.relationType, 0.98, {
              type: 'asl_reference',
              statePath: reference.statePath,
              integration: reference.integration,
              target: reference.arn,
            });
          }
        }
        nextToken = resources.size < MAX_RESOURCES ? response.nextToken : null;
      } while (nextToken);
    }

    for (const [source, reader] of [
      ['lambda', listLambdaFunctions],
      ['stepfunctions', listStateMachines],
      ['eventbridge', listEventBridgeRules],
    ]) {
      try {
        await reader();
      } catch (error) {
        if (error.statusCode === 429) throw error;
        failures.push({ source, code: error.name || 'AWS_INVENTORY_FAILED' });
      }
    }

    const values = [...resources.values()];
    const accountId = values.map(resource => accountFromArn(resource.arn)).find(value => /^\d{12}$/.test(value)) || '';
    return {
      accountId,
      resources: values,
      relationships: [...relationships.values()],
      failures,
      requests,
      truncated: resources.size >= MAX_RESOURCES,
    };
  }

  return { analyze };
}

function referenceFromArn(arn) {
  const value = String(arn || '');
  if (value.includes(':lambda:') && value.includes(':function:')) {
    const parts = value.split(':');
    return { type: 'lambda', name: parts[parts.indexOf('function') + 1] || lastArnSegment(value), arn: value };
  }
  if (value.includes(':states:') && value.includes(':stateMachine:')) {
    return { type: 'stepfunctions', name: lastArnSegment(value), arn: value };
  }
  if (value.includes(':sqs:')) return { type: 'sqs', name: lastArnSegment(value), arn: value };
  if (value.includes(':ecs:')) return { type: 'ecs', name: lastArnSegment(value), arn: value };
  if (value.includes(':s3:::')) return { type: 's3', name: value.split(':s3:::')[1].split('/')[0], arn: value };
  if (value.includes(':dynamodb:') && value.includes(':table/')) {
    return { type: 'dynamodb', name: lastArnSegment(value), arn: value };
  }
  if (value.includes(':sns:')) return { type: 'sns', name: lastArnSegment(value), arn: value };
  return null;
}

const SQS_QUEUE_URL_PATTERN = /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/([^/?]+)/i;

// Resolves a Lambda environment-variable value to a known resource without downloading or running the function's code.
function referenceFromEnvValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('arn:aws:')) return referenceFromArn(trimmed);
  const queueMatch = trimmed.match(SQS_QUEUE_URL_PATTERN);
  if (queueMatch) return { type: 'sqs', name: queueMatch[1], arn: null };
  return null;
}

module.exports = {
  MAX_RESOURCES,
  createAwsRegionalInventoryReader,
  inventoryResource,
  referenceFromArn,
  referenceFromEnvValue,
  resourceIdentity,
};