'use strict';

const AdmZip = require('adm-zip');
const { LambdaClient, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { referenceFromEnvValue } = require('./awsRegionalInventoryReader');

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024; // skip unusually large deployment packages instead of downloading them
const MAX_SCANNED_BYTES = 2 * 1024 * 1024; // cap total source text actually scanned per function
const MAX_ENTRIES_SCANNED = 200;
const TEXT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.py', '.rb', '.go', '.java', '.json'];
const SKIP_PATH_SEGMENTS = ['node_modules/', 'vendor/', 'site-packages/', 'dist/', '.git/'];

const SDK_CLIENT_PATTERNS = [
  { type: 'sqs', pattern: /new\s+SQS(Client)?\s*\(|boto3\.(client|resource)\(\s*['"]sqs['"]|\.(sendMessage|receiveMessage|send_message|receive_message)\s*\(/ },
  { type: 'sns', pattern: /new\s+SNS(Client)?\s*\(|boto3\.(client|resource)\(\s*['"]sns['"]|\.publish\s*\(/ },
  { type: 'dynamodb', pattern: /new\s+DynamoDB(Client|DocumentClient)?\s*\(|boto3\.(client|resource)\(\s*['"]dynamodb['"]/ },
  { type: 's3', pattern: /new\s+S3(Client)?\s*\(|boto3\.(client|resource)\(\s*['"]s3['"]/ },
  { type: 'lambda', pattern: /new\s+Lambda(Client)?\s*\(|boto3\.client\(\s*['"]lambda['"]/ },
  { type: 'stepfunctions', pattern: /new\s+SFN(Client)?\s*\(|boto3\.client\(\s*['"]stepfunctions['"]/ },
];

const ARN_LITERAL_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[^\s'"`)]+/g;
const SQS_URL_LITERAL_PATTERN = /https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[^\s'"`)]+/g;

function isScannableEntry(entryName) {
  const lower = entryName.toLowerCase();
  if (SKIP_PATH_SEGMENTS.some(segment => lower.includes(segment))) return false;
  return TEXT_EXTENSIONS.some(extension => lower.endsWith(extension));
}

function literalsIn(text) {
  const values = new Set();
  for (const match of text.match(ARN_LITERAL_PATTERN) || []) values.add(match);
  for (const match of text.match(SQS_URL_LITERAL_PATTERN) || []) values.add(match);
  return [...values];
}

function detectedSdkClients(text) {
  return SDK_CLIENT_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ type }) => type);
}

// Reads deployment package contents as plain text and pattern-matches them; never evaluates or runs the code.
function analyzeDeploymentPackage(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries()
    .filter(entry => !entry.isDirectory && isScannableEntry(entry.entryName))
    .slice(0, MAX_ENTRIES_SCANNED);
  const references = new Map();
  const sdkClients = new Set();
  let scannedBytes = 0;
  let truncated = false;

  for (const entry of entries) {
    if (scannedBytes >= MAX_SCANNED_BYTES) { truncated = true; break; }
    const remaining = MAX_SCANNED_BYTES - scannedBytes;
    const content = entry.getData().slice(0, remaining).toString('utf8');
    scannedBytes += Buffer.byteLength(content, 'utf8');

    for (const literal of literalsIn(content)) {
      const reference = referenceFromEnvValue(literal);
      if (!reference) continue;
      const key = `${reference.type}:${reference.name}`;
      const current = references.get(key) || { ...reference, files: new Set() };
      current.files.add(entry.entryName);
      references.set(key, current);
    }
    for (const client of detectedSdkClients(content)) sdkClients.add(client);
  }

  return {
    references: [...references.values()].map(reference => ({ ...reference, files: [...reference.files] })),
    sdkClients: [...sdkClients],
    filesScanned: entries.length,
    truncated,
  };
}

function createAwsLambdaCodeReader({
  configResolver = resolveAwsConfig,
  lambdaFactory = config => new LambdaClient(config),
  fetchImpl = (...args) => fetch(...args),
  beforeRequest = () => {},
} = {}) {
  return {
    async analyze({ profileId, region, functionName }) {
      if (!functionName) throw Object.assign(new Error('functionName is required'), { statusCode: 400 });
      const config = { ...await configResolver(profileId), region };
      const lambda = lambdaFactory(config);
      beforeRequest({ profileId, region, operation: 'GetFunction' });
      const response = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
      const codeSize = response.Configuration?.CodeSize || 0;
      const location = response.Code?.Location;
      if (!location) {
        return { functionName, references: [], sdkClients: [], filesScanned: 0, truncated: false, skipped: true, reason: 'no_code_location' };
      }
      if (codeSize > MAX_PACKAGE_BYTES) {
        return { functionName, references: [], sdkClients: [], filesScanned: 0, truncated: false, skipped: true, reason: 'package_too_large', codeSize };
      }
      const download = await fetchImpl(location);
      if (!download.ok) {
        throw Object.assign(new Error('Could not download the Lambda deployment package'), { statusCode: 502 });
      }
      const buffer = Buffer.from(await download.arrayBuffer());
      return { functionName, codeSize, skipped: false, ...analyzeDeploymentPackage(buffer) };
    },
  };
}

module.exports = { createAwsLambdaCodeReader, analyzeDeploymentPackage };
