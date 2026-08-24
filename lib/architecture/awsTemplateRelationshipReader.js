'use strict';

const yaml = require('js-yaml');
const { CloudFormationClient, GetTemplateCommand } = require('@aws-sdk/client-cloudformation');
const { resolveAwsConfig } = require('../awsProfileResolver');

function intrinsicType(tag, key, kind) {
  return new yaml.Type(tag, { kind, construct: value => ({ [key]: value }) });
}

const CLOUDFORMATION_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  intrinsicType('!Ref', 'Ref', 'scalar'),
  intrinsicType('!GetAtt', 'Fn::GetAtt', 'scalar'),
  intrinsicType('!Sub', 'Fn::Sub', 'scalar'),
  intrinsicType('!Sub', 'Fn::Sub', 'sequence'),
  ...[
    ['!Join', 'Fn::Join'], ['!Select', 'Fn::Select'], ['!Split', 'Fn::Split'],
    ['!FindInMap', 'Fn::FindInMap'], ['!If', 'Fn::If'], ['!Equals', 'Fn::Equals'],
    ['!And', 'Fn::And'], ['!Or', 'Fn::Or'], ['!Not', 'Fn::Not'], ['!Cidr', 'Fn::Cidr'],
  ].map(([tag, key]) => intrinsicType(tag, key, 'sequence')),
  intrinsicType('!ImportValue', 'Fn::ImportValue', 'scalar'),
  intrinsicType('!Base64', 'Fn::Base64', 'scalar'),
  intrinsicType('!Condition', 'Condition', 'scalar'),
]);

function parseTemplate(body) {
  if (body && typeof body === 'object') return body;
  try { return yaml.load(String(body || ''), { schema: CLOUDFORMATION_SCHEMA }) || {}; } catch (_) {
    throw Object.assign(new Error('CloudFormation template could not be parsed'), { statusCode: 502 });
  }
}

function templateRelationships(body, stackName = '') {
  const resources = parseTemplate(body).Resources || {};
  const knownIds = new Set(Object.keys(resources));
  const relationships = new Map();

  function relationType(sourceLogicalId, targetLogicalId, path) {
    const sourceType = resources[sourceLogicalId]?.Type;
    const targetType = resources[targetLogicalId]?.Type;
    if (sourceType === 'AWS::Events::Rule' && path.includes('.Properties.Targets')) return 'triggers';
    if (sourceType === 'AWS::S3::Bucket' && path.includes('.Properties.NotificationConfiguration')) return 'triggers';
    if (sourceType === 'AWS::StepFunctions::StateMachine' && path.includes('.Properties.Definition')) return 'invokes';
    if (sourceType === 'AWS::ECS::Service' && path.includes('.Properties.Cluster')) return 'runs_on';
    if (/^AWS::IAM::(Policy|ManagedPolicy)$/.test(sourceType) && /\.Properties\.(Roles|Users|Groups)/.test(path)) return 'attaches_to';
    if (/Policy$/.test(sourceType) && !/Policy$/.test(targetType)) return 'governs';
    if (targetType === 'AWS::IAM::Role' && /\.Properties\.(Role|RoleArn)/.test(path)) return 'uses_role';
    if (/^AWS::IAM::(Policy|ManagedPolicy)$/.test(targetType) && path.includes('.Properties.ManagedPolicyArns')) return 'uses_policy';
    if (sourceType === 'AWS::Lambda::Permission' && path.includes('.Properties.FunctionName')) return 'authorizes';
    return 'depends_on';
  }

  function add(sourceLogicalId, targetLogicalId, path, intrinsic, type = relationType(sourceLogicalId, targetLogicalId, path), confidence = 0.95) {
    if (!knownIds.has(targetLogicalId) || sourceLogicalId === targetLogicalId) return;
    const key = `${sourceLogicalId}:${targetLogicalId}:${type}`;
    const current = relationships.get(key) || {
      stackName, sourceLogicalId, targetLogicalId, relationType: type, confidence, evidence: [],
    };
    current.evidence.push({ type: 'cloudformation_reference', path, intrinsic });
    relationships.set(key, current);
  }

  function references(value, result = new Set()) {
    if (Array.isArray(value)) {
      value.forEach(item => references(item, result));
      return result;
    }
    if (!value || typeof value !== 'object') return result;
    if (typeof value.Ref === 'string' && knownIds.has(value.Ref)) result.add(value.Ref);
    const getAtt = value['Fn::GetAtt'];
    const getAttId = Array.isArray(getAtt) ? getAtt[0] : typeof getAtt === 'string' ? getAtt.split('.')[0] : '';
    if (knownIds.has(getAttId)) result.add(getAttId);
    Object.values(value).forEach(child => references(child, result));
    return result;
  }

  function addLambdaEventSourceMapping(logicalId, properties) {
    const functions = references(properties.FunctionName);
    const eventSources = references(properties.EventSourceArn);
    for (const eventSource of eventSources) {
      for (const fn of functions) {
        add(eventSource, fn, `Resources.${logicalId}.Properties`, 'AWS::Lambda::EventSourceMapping', 'triggers', 0.99);
      }
    }
  }

  function visit(sourceLogicalId, value, path) {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(sourceLogicalId, item, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    if (typeof value.Ref === 'string') add(sourceLogicalId, value.Ref, path, 'Ref');
    const getAtt = value['Fn::GetAtt'];
    if (typeof getAtt === 'string') add(sourceLogicalId, getAtt.split('.')[0], path, 'Fn::GetAtt');
    if (Array.isArray(getAtt)) add(sourceLogicalId, getAtt[0], path, 'Fn::GetAtt');
    const substitution = value['Fn::Sub'];
    const template = Array.isArray(substitution) ? substitution[0] : substitution;
    if (typeof template === 'string') {
      for (const match of template.matchAll(/\$\{([A-Za-z0-9]+)(?:\.[^}]+)?\}/g)) {
        add(sourceLogicalId, match[1], path, 'Fn::Sub');
      }
    }
    for (const [key, child] of Object.entries(value)) visit(sourceLogicalId, child, `${path}.${key}`);
  }

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type === 'AWS::Lambda::EventSourceMapping') {
      addLambdaEventSourceMapping(logicalId, resource.Properties || {});
      continue;
    }
    const dependencies = Array.isArray(resource.DependsOn) ? resource.DependsOn : [resource.DependsOn].filter(Boolean);
    dependencies.forEach(target => add(logicalId, target, `Resources.${logicalId}.DependsOn`, 'DependsOn'));
    visit(logicalId, resource.Properties || {}, `Resources.${logicalId}.Properties`);
  }
  return [...relationships.values()];
}

function createAwsTemplateRelationshipReader({
  configResolver = resolveAwsConfig,
  clientFactory = config => new CloudFormationClient(config),
  beforeRequest = () => {},
} = {}) {
  return {
    async analyze({ profileId, region, stackNames }) {
      const client = clientFactory({ ...await configResolver(profileId), region });
      const relationships = [];
      const failures = [];
      let requests = 0;
      for (const stackName of [...new Set(stackNames || [])]) {
        try {
          beforeRequest({ profileId, region, operation: 'GetTemplate' });
          const response = await client.send(new GetTemplateCommand({ StackName: stackName, TemplateStage: 'Processed' }));
          requests += 1;
          relationships.push(...templateRelationships(response.TemplateBody, stackName));
        } catch (error) {
          if (error.statusCode === 429) throw error;
          requests += 1;
          failures.push({ stackName, code: error.name || 'GET_TEMPLATE_FAILED' });
        }
      }
      return { requests, relationships, failures };
    },
  };
}

module.exports = { createAwsTemplateRelationshipReader, parseTemplate, templateRelationships };