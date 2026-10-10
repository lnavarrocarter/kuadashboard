'use strict';

// Access assistant for AWS permission errors: classifies SDK errors, works out
// which IAM actions a KUA request needs, and proposes a policy to grant them.
// Scope: the services KUA already integrates (see lib/awsIamCatalog.json).

const DENIED_NAMES = new Set([
  'AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation', 'UnauthorizedException',
  'AuthorizationError', 'AuthorizationErrorException', 'NotAuthorized',
]);

/**
 * Classifies an AWS SDK error: 'denied' (IAM permission), 'expired'
 * (session credentials), 'timeout' or 'error'. For denied errors the IAM
 * action, resource and principal are read from the message when AWS
 * includes them ("User: arn:… is not authorized to perform: x:Y on resource: z").
 */
function classifyAwsError(err = {}) {
  const name = err.name || err.Code || '';
  const message = err.message || String(err);
  const status = err.$metadata?.httpStatusCode;
  if (name === 'TimeoutError') return { kind: 'timeout', message };
  if (/ExpiredToken|RequestExpired/.test(name) || /security token.*expired/i.test(message)) return { kind: 'expired', message };
  const denied = DENIED_NAMES.has(name) || /is not authorized to perform|not authorized to perform|AccessDenied/i.test(message) || status === 403;
  if (!denied) return { kind: 'error', message };
  const action = message.match(/perform:\s*([a-z0-9-]+:[A-Za-z0-9*]+)/i)?.[1] || null;
  const resource = message.match(/on resource:\s*(\S+?)(?:\s|$|\.? because)/)?.[1] || null;
  const principal = message.match(/User:\s*(arn:\S+)/)?.[1] || null;
  return { kind: 'denied', message, action, resource, principal };
}

// IAM service prefix per AWS SDK v3 package.
const SERVICE_PREFIX = {
  'client-athena': 'athena',
  'client-bedrock': 'bedrock',
  'client-cloudformation': 'cloudformation',
  'client-cloudfront': 'cloudfront',
  'client-cloudtrail': 'cloudtrail',
  'client-cloudwatch': 'cloudwatch',
  'client-cloudwatch-logs': 'logs',
  'client-cognito-identity-provider': 'cognito-idp',
  'client-data-pipeline': 'datapipeline',
  'client-docdb': 'rds',
  'client-dynamodb': 'dynamodb',
  'client-ec2': 'ec2',
  'client-ecr': 'ecr',
  'client-ecs': 'ecs',
  'client-eks': 'eks',
  'client-elastic-load-balancing': 'elasticloadbalancing',
  'client-elastic-load-balancing-v2': 'elasticloadbalancing',
  'client-eventbridge': 'events',
  'client-glue': 'glue',
  'client-iam': 'iam',
  'client-lambda': 'lambda',
  'client-lex-models-v2': 'lex',
  'client-lex-runtime-v2': 'lex',
  'client-rds': 'rds',
  'client-resource-groups-tagging-api': 'tag',
  'client-route-53': 'route53',
  'client-s3': 's3',
  'client-secrets-manager': 'secretsmanager',
  'client-sesv2': 'ses',
  'client-sfn': 'states',
  'client-sns': 'sns',
  'client-sqs': 'sqs',
  'client-ssm': 'ssm',
};

// SDK operations whose IAM action has a different name.
const ACTION_OVERRIDES = {
  's3:ListBuckets': 's3:ListAllMyBuckets',
  's3:ListObjectsV2': 's3:ListBucket',
  's3:ListObjects': 's3:ListBucket',
  's3:HeadObject': 's3:GetObject',
  's3:HeadBucket': 's3:ListBucket',
  's3:PutPublicAccessBlock': 's3:PutBucketPublicAccessBlock',
  's3:GetBucketEncryption': 's3:GetEncryptionConfiguration',
  's3:DeleteBucketTagging': 's3:PutBucketTagging',
  'lambda:Invoke': 'lambda:InvokeFunction',
};

// API Gateway authorizes by HTTP verb (apigateway:GET, …), not by operation.
const APIGATEWAY_VERBS = [['Get', 'GET'], ['Create', 'POST'], ['Import', 'PUT'], ['Put', 'PUT'], ['Update', 'PATCH'], ['Delete', 'DELETE'], ['Tag', 'PUT'], ['Untag', 'DELETE']];

/** IAM action for an SDK command, e.g. ('client-lambda', 'ListFunctions') → 'lambda:ListFunctions'. */
function commandToAction(pkg, operation) {
  if (pkg === 'client-api-gateway' || pkg === 'client-apigatewayv2') {
    const verb = APIGATEWAY_VERBS.find(([prefix]) => operation.startsWith(prefix))?.[1] || 'GET';
    return `apigateway:${verb}`;
  }
  if (pkg === 'client-sts' && operation === 'GetCallerIdentity') return null; // never needs a permission
  const prefix = SERVICE_PREFIX[pkg];
  if (!prefix) return null;
  const action = `${prefix}:${operation}`;
  return ACTION_OVERRIDES[action] || action;
}

const ROUTE_RE = /^router\.(get|post|put|patch|delete)\('([^']+)'/gm;
const REQUIRE_RE = /const\s*\{([^}]*)\}\s*=\s*require\('@aws-sdk\/(client-[a-z0-9-]+)'\)/g;

/**
 * Reads routes/aws.js source and lists, per "METHOD /path", the IAM actions of
 * the SDK commands its handler imports (some are passed to lib/ helpers rather
 * than instantiated in the route). Used to generate lib/awsIamCatalog.json.
 */
function extractRouteCatalog(source) {
  const routes = [];
  let match;
  while ((match = ROUTE_RE.exec(source))) routes.push({ key: `${match[1].toUpperCase()} ${match[2]}`, start: match.index });
  const catalog = {};
  routes.forEach((route, index) => {
    const block = source.slice(route.start, routes[index + 1]?.start ?? source.length);
    const actions = new Set();
    for (const req of block.matchAll(REQUIRE_RE)) {
      req[1].split(',').map(name => name.trim().split(/\s*:\s*/)[0]).filter(name => name.endsWith('Command'))
        .forEach(name => {
          const action = commandToAction(req[2], name.replace(/Command$/, ''));
          if (action) actions.add(action);
        });
    }
    if (actions.size) catalog[route.key] = [...actions].sort();
  });
  return catalog;
}

let bundledCatalog = null;
function routeCatalog() {
  if (!bundledCatalog) bundledCatalog = require('./awsIamCatalog.json');
  return bundledCatalog;
}

/**
 * Builds the access request for a denied call. The action AWS reported is
 * certain; the route's catalog adds the other actions the same screen needs,
 * so one grant fixes the whole view.
 */
function buildAccessRequest({ error, route = null, catalog = routeCatalog(), account = null, region = null } = {}) {
  if (!error || error.kind !== 'denied') return null;
  const failedAction = error.action || null;
  const routeActions = (route && catalog[route]) || [];
  const others = routeActions.filter(action => action !== failedAction);
  const actions = failedAction ? [failedAction, ...others] : routeActions;
  if (!actions.length) {
    return { failedAction: null, actions: [], resource: error.resource || null, principal: error.principal || null, account, region, route, source: 'unknown', policy: null };
  }
  const specificResource = error.resource && error.resource !== '*' ? error.resource : null;
  const statements = [];
  if (failedAction && specificResource) {
    statements.push({ Sid: 'KuaFailedAction', Effect: 'Allow', Action: [failedAction], Resource: specificResource });
    if (others.length) statements.push({ Sid: 'KuaScreenActions', Effect: 'Allow', Action: others, Resource: '*' });
  } else {
    statements.push({ Sid: 'KuaAccess', Effect: 'Allow', Action: actions, Resource: '*' });
  }
  return {
    failedAction,
    actions,
    resource: error.resource || null,
    principal: error.principal || null,
    account,
    region,
    route,
    source: failedAction ? 'error' : 'route',
    policy: { Version: '2012-10-17', Statement: statements },
  };
}

module.exports = {
  classifyAwsError,
  commandToAction,
  extractRouteCatalog,
  buildAccessRequest,
};
