'use strict';

const { lazyModule } = require('../lazyModule');
const eventbridgeSdk = lazyModule('@aws-sdk/client-eventbridge');
const lambdaSdk = lazyModule('@aws-sdk/client-lambda');
const sfnSdk = lazyModule('@aws-sdk/client-sfn');
const iamSdk = lazyModule('@aws-sdk/client-iam');
const snsSdk = lazyModule('@aws-sdk/client-sns');
const ecsSdk = lazyModule('@aws-sdk/client-ecs');
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
    loadbalancer: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    targetgroup: 'AWS::ElasticLoadBalancingV2::TargetGroup',
  }[type] || 'AWS::Resource';
}

function inventoryResource({ type, name, arn = null, service = '', details = null }) {
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
    ...(details && Object.keys(details).length ? { details } : {}),
  };
}

function referencedResource(reference) {
  if (!reference?.type || !reference?.name) return null;
  return inventoryResource(reference);
}

// A policy resource ARN can carry a trailing wildcard (e.g. table/orders*); resolve it like a plain ARN reference.
function referenceFromPolicyResource(resource) {
  if (typeof resource !== 'string' || !resource.startsWith('arn:aws:')) return null;
  const reference = referenceFromArn(resource);
  if (!reference) return null;
  const name = String(reference.name || '').replace(/\*+$/, '');
  if (!name || name === '*') return null;
  return { ...reference, name, arn: resource };
}

function decodePolicyDocument(raw) {
  try { return JSON.parse(decodeURIComponent(raw || '')); } catch (_) { return null; }
}

// Only 'Allow' statements against specific (non-wildcard) resource ARNs are meaningful capability signals.
function referencesFromPolicyDocument(document, policyName) {
  const statements = Array.isArray(document?.Statement) ? document.Statement : [document?.Statement].filter(Boolean);
  const references = [];
  for (const statement of statements) {
    if (statement?.Effect !== 'Allow') continue;
    const resourceList = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource].filter(Boolean);
    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action].filter(Boolean);
    for (const resourceArn of resourceList) {
      const reference = referenceFromPolicyResource(resourceArn);
      if (!reference) continue;
      references.push({ reference, policyName, actions });
    }
  }
  return references;
}

function createAwsRegionalInventoryReader({
  configResolver = resolveAwsConfig,
  lambdaFactory = config => new lambdaSdk.LambdaClient(config),
  eventBridgeFactory = config => new eventbridgeSdk.EventBridgeClient(config),
  sfnFactory = config => new sfnSdk.SFNClient(config),
  iamFactory = config => new iamSdk.IAMClient(config),
  snsFactory = config => new snsSdk.SNSClient(config),
  ecsFactory = config => new ecsSdk.ECSClient(config),
  loadBalancerReader = null,
  codeReader = null,
  beforeRequest = () => {},
} = {}) {
  async function analyze({ profileId, region, lambdaCodeAnalysisNames = [] }) {
    const config = { ...await configResolver(profileId), region };
    const lambda = lambdaFactory(config);
    const eventBridge = eventBridgeFactory(config);
    const sfn = sfnFactory(config);
    const iam = iamFactory(config);
    const sns = snsFactory(config);
    const ecs = ecsFactory(config);
    const codeAnalysisNames = new Set(lambdaCodeAnalysisNames);
    const resources = new Map();
    const relationships = new Map();
    const roleReferenceCache = new Map();
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

    // Reads the Lambda's execution role policies (metadata only) to surface capability-based references
    // (e.g. "this role can SendMessage to queue X") even when nothing in config/CloudFormation points to it.
    // Cached per role name since many functions commonly share one execution role.
    async function addRoleReferences(source, roleArn) {
      const roleName = lastArnSegment(roleArn);
      if (!roleName) return;
      if (!roleReferenceCache.has(roleName)) {
        const references = [];
        try {
          let marker;
          do {
            const response = await send(iam, new iamSdk.ListAttachedRolePoliciesCommand({ RoleName: roleName, Marker: marker }));
            for (const policy of response.AttachedPolicies || []) {
              const policyResponse = await send(iam, new iamSdk.GetPolicyCommand({ PolicyArn: policy.PolicyArn }));
              const versionId = policyResponse.Policy?.DefaultVersionId;
              if (!versionId) continue;
              const versionResponse = await send(iam, new iamSdk.GetPolicyVersionCommand({ PolicyArn: policy.PolicyArn, VersionId: versionId }));
              const document = decodePolicyDocument(versionResponse.PolicyVersion?.Document);
              if (document) references.push(...referencesFromPolicyDocument(document, policy.PolicyName));
            }
            marker = response.IsTruncated ? response.Marker : null;
          } while (marker);

          marker = undefined;
          do {
            const response = await send(iam, new iamSdk.ListRolePoliciesCommand({ RoleName: roleName, Marker: marker }));
            for (const policyName of response.PolicyNames || []) {
              const policyResponse = await send(iam, new iamSdk.GetRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }));
              const document = decodePolicyDocument(policyResponse.PolicyDocument);
              if (document) references.push(...referencesFromPolicyDocument(document, policyName));
            }
            marker = response.IsTruncated ? response.Marker : null;
          } while (marker);
          roleReferenceCache.set(roleName, references);
        } catch (error) {
          if (error.statusCode === 429) throw error;
          failures.push({ source: 'iam-role', code: error.name || 'IAM_ROLE_READ_FAILED' });
          roleReferenceCache.set(roleName, []);
        }
      }
      for (const { reference, policyName, actions } of roleReferenceCache.get(roleName)) {
        const target = referencedResource(reference);
        if (!target || target.identity === source.identity) continue;
        addResource(target);
        addRelationship(source.identity, target.identity, 'accesses', 0.5, {
          type: 'iam_role_policy',
          policyName,
          actions,
        });
      }
    }

    // Explicit opt-in only: downloads and statically pattern-matches the deployment package (never executes it)
    // for functions the caller selected via lambdaCodeAnalysisNames.
    async function addCodeReferences(source, functionName) {
      let analysis;
      try {
        analysis = await codeReader.analyze({ profileId, region, functionName });
      } catch (error) {
        if (error.statusCode === 429) throw error;
        failures.push({ source: 'lambda-code', code: error.name || 'LAMBDA_CODE_READ_FAILED' });
        return;
      }
      for (const reference of analysis.references || []) {
        const target = referencedResource(reference);
        if (!target || target.identity === source.identity) continue;
        addResource(target);
        addRelationship(source.identity, target.identity, 'references', 0.55, {
          type: 'lambda_code_reference',
          files: reference.files,
          sdkClients: analysis.sdkClients,
        });
      }
    }

    async function listLambdaFunctions() {
      let marker;
      do {
        const response = await send(lambda, new lambdaSdk.ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
        for (const fn of response.Functions || []) {
          const source = inventoryResource({ type: 'lambda', name: fn.FunctionName, arn: fn.FunctionArn || null });
          addResource(source);
          addEnvironmentReferences(source, fn.Environment?.Variables);
          await addRoleReferences(source, fn.Role);
          if (codeReader && codeAnalysisNames.has(fn.FunctionName)) await addCodeReferences(source, fn.FunctionName);
        }
        marker = resources.size < MAX_RESOURCES ? response.NextMarker : null;
      } while (marker);

      marker = undefined;
      do {
        const response = await send(lambda, new lambdaSdk.ListEventSourceMappingsCommand({ Marker: marker, MaxItems: 100 }));
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
        const busResponse = await send(eventBridge, new eventbridgeSdk.ListEventBusesCommand({ NextToken: busToken, Limit: 50 }));
        for (const bus of busResponse.EventBuses || []) {
          let ruleToken;
          do {
            const ruleResponse = await send(eventBridge, new eventbridgeSdk.ListRulesCommand({
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
                const targetResponse = await send(eventBridge, new eventbridgeSdk.ListTargetsByRuleCommand({
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
        const response = await send(sfn, new sfnSdk.ListStateMachinesCommand({ nextToken, maxResults: 100 }));
        for (const stateMachine of response.stateMachines || []) {
          const source = inventoryResource({
            type: 'stepfunctions',
            name: stateMachine.name,
            arn: stateMachine.stateMachineArn,
          });
          addResource(source);
          if (!resources.has(source.identity)) break;
          const detail = await send(sfn, new sfnSdk.DescribeStateMachineCommand({ stateMachineArn: stateMachine.stateMachineArn }));
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

    async function listSnsTopics() {
      let nextToken;
      do {
        const response = await send(sns, new snsSdk.ListTopicsCommand({ NextToken: nextToken }));
        for (const topic of response.Topics || []) {
          const topicArn = topic.TopicArn;
          if (!topicArn) continue;
          const source = inventoryResource({ type: 'sns', name: lastArnSegment(topicArn), arn: topicArn });
          addResource(source);
          if (!resources.has(source.identity)) break;
          let subscriptionToken;
          do {
            const subscriptionResponse = await send(sns, new snsSdk.ListSubscriptionsByTopicCommand({
              TopicArn: topicArn,
              NextToken: subscriptionToken,
            }));
            for (const subscription of subscriptionResponse.Subscriptions || []) {
              // Only ARN-shaped endpoints (sqs/lambda/application/firehose) map to an AWS resource;
              // email/http(s)/sms endpoints are never turned into resources or evidence.
              if (!subscription.Endpoint?.startsWith('arn:') || subscription.SubscriptionArn === 'PendingConfirmation') continue;
              const reference = referenceFromArn(subscription.Endpoint);
              const target = referencedResource(reference);
              if (!target) continue;
              addResource(target);
              addRelationship(source.identity, target.identity, 'triggers', 0.95, {
                type: 'sns_subscription',
                protocol: subscription.Protocol || '',
                subscriptionArn: subscription.SubscriptionArn || '',
                endpoint: subscription.Endpoint,
              });
            }
            subscriptionToken = subscriptionResponse.NextToken;
          } while (subscriptionToken && resources.size < MAX_RESOURCES);
        }
        nextToken = resources.size < MAX_RESOURCES ? response.NextToken : null;
      } while (nextToken);
    }

    async function listLoadBalancers() {
      if (!loadBalancerReader || resources.size >= MAX_RESOURCES) return;
      let result;
      try {
        result = await loadBalancerReader({
          profileId, region,
          beforeRequest: ({ operation }) => {
            beforeRequest({ profileId, region, operation });
            requests += 1;
          },
        });
      } catch (error) {
        if (error.statusCode === 429) throw error;
        failures.push({ source: 'load-balancers', code: error.name || 'ELB_INVENTORY_FAILED' });
        return;
      }
      failures.push(...(result.unavailable || []).map(item => ({ source: item.source, code: item.error?.kind || 'ELB_SOURCE_UNAVAILABLE' })));
      for (const lb of result.loadBalancers || []) {
        const loadBalancer = inventoryResource({
          type: 'loadbalancer', name: lb.name, arn: lb.arn,
          details: { dnsName: lb.dnsName || '' },
        });
        addResource(loadBalancer);
        const attachedGroups = new Map((lb.targetGroups || []).filter(group => group.arn).map(group => [group.arn, group]));
        for (const group of attachedGroups.values()) {
          const targetGroup = inventoryResource({
            type: 'targetgroup', name: group.name, arn: group.arn,
            details: { loadBalancerArns: group.loadBalancerArns || [] },
          });
          addResource(targetGroup);
          addRelationship(loadBalancer.identity, targetGroup.identity, 'routes_to', 0.95, {
            type: 'elb_target_group_attachment',
            loadBalancerArn: lb.arn,
            targetGroupArn: group.arn,
            listenerPorts: (lb.listeners || []).map(listener => listener.port).filter(port => port != null),
          });
        }
      }

      const targetGroups = new Map((result.loadBalancers || []).flatMap(lb => (lb.targetGroups || [])
        .filter(group => group.arn).map(group => [group.arn, group])));
      if (!targetGroups.size) return;
      try {
        let clusterToken;
        do {
          const clusterPage = await send(ecs, new ecsSdk.ListClustersCommand({ nextToken: clusterToken, maxResults: 100 }));
          for (const clusterArn of clusterPage.clusterArns || []) {
            let serviceToken;
            do {
              const servicePage = await send(ecs, new ecsSdk.ListServicesCommand({ cluster: clusterArn, nextToken: serviceToken, maxResults: 100 }));
              const serviceArns = servicePage.serviceArns || [];
              for (let index = 0; index < serviceArns.length; index += 10) {
                const described = await send(ecs, new ecsSdk.DescribeServicesCommand({ cluster: clusterArn, services: serviceArns.slice(index, index + 10) }));
                for (const service of described.services || []) {
                  const serviceResource = inventoryResource({ type: 'ecs', name: service.serviceName, arn: service.serviceArn });
                  for (const attachment of service.loadBalancers || []) {
                    const group = targetGroups.get(attachment.targetGroupArn);
                    if (!group) continue;
                    addResource(serviceResource);
                    addRelationship(group.arn, serviceResource.identity, 'routes_to', 0.99, {
                      type: 'ecs_load_balancer',
                      targetGroupArn: attachment.targetGroupArn,
                      containerName: attachment.containerName || '',
                      containerPort: attachment.containerPort ?? null,
                    });
                  }
                }
              }
              serviceToken = servicePage.nextToken;
            } while (serviceToken && resources.size < MAX_RESOURCES);
          }
          clusterToken = clusterPage.nextToken;
        } while (clusterToken && resources.size < MAX_RESOURCES);
      } catch (error) {
        if (error.statusCode === 429) throw error;
        failures.push({ source: 'ecs-load-balancers', code: error.name || 'ECS_INVENTORY_FAILED' });
      }
    }

    for (const [source, reader] of [
      ['lambda', listLambdaFunctions],
      ['stepfunctions', listStateMachines],
      ['eventbridge', listEventBridgeRules],
      ['sns', listSnsTopics],
      ['load-balancers', listLoadBalancers],
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
  return genericArnReference(value);
}

// Generic fallback so ANY recognizable AWS ARN becomes a suggested resource instead of being silently dropped,
// even for services this reader has no dedicated handling for yet (Kinesis, API destinations, KMS, RDS, etc.).
function genericArnReference(value) {
  const parts = value.split(':');
  if (parts[0] !== 'arn' || parts.length < 6 || !parts[2]) return null;
  const resourcePart = parts.slice(5).join(':');
  const name = resourcePart.split('/').pop().split(':').pop();
  if (!name) return null;
  return { type: parts[2], name, arn: value };
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
  genericArnReference,
  inventoryResource,
  referenceFromArn,
  referenceFromEnvValue,
  referenceFromPolicyResource,
  referencesFromPolicyDocument,
  resourceIdentity,
};