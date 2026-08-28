'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');
const { createAwsLambdaCodeReader, analyzeDeploymentPackage } = require('./awsLambdaCodeReader');

function zipBuffer(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

test('analyzeDeploymentPackage finds literal AWS resource references and SDK client usage without executing the code', () => {
  const buffer = zipBuffer({
    'index.js': [
      "const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');",
      "const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue';",
      "const client = new SQSClient({});",
      "exports.handler = async () => { await client.send(new SendMessageCommand({ QueueUrl: QUEUE_URL })); };",
    ].join('\n'),
    'node_modules/@aws-sdk/client-sqs/index.js': "arn:aws:sqs:us-east-1:123456789012:should-be-ignored",
  });

  const result = analyzeDeploymentPackage(buffer);

  assert.deepEqual(result.references.map(reference => reference.name), ['dispatch-queue']);
  assert.deepEqual(result.references[0].files, ['index.js']);
  assert.deepEqual(result.sdkClients, ['sqs']);
  assert.equal(result.filesScanned, 1);
  assert.equal(result.truncated, false);
});

test('createAwsLambdaCodeReader downloads the deployment package only via the presigned Code.Location and never executes it', async () => {
  const buffer = zipBuffer({ 'index.js': "arn:aws:dynamodb:us-east-1:123456789012:table/dispatch-jobs" });
  let downloadedUrl = null;
  const reader = createAwsLambdaCodeReader({
    configResolver: async () => ({}),
    lambdaFactory: () => ({
      async send() {
        return {
          Configuration: { CodeSize: buffer.length },
          Code: { Location: 'https://example-bucket.s3.amazonaws.com/dispatcher.zip?signature=abc' },
        };
      },
    }),
    fetchImpl: async url => {
      downloadedUrl = url;
      return { ok: true, arrayBuffer: async () => buffer };
    },
  });

  const result = await reader.analyze({ profileId: 'local:dev', region: 'us-east-1', functionName: 'dispatcher' });

  assert.equal(downloadedUrl, 'https://example-bucket.s3.amazonaws.com/dispatcher.zip?signature=abc');
  assert.equal(result.skipped, false);
  assert.deepEqual(result.references.map(reference => reference.name), ['dispatch-jobs']);
});

test('createAwsLambdaCodeReader skips unusually large deployment packages instead of downloading them', async () => {
  const reader = createAwsLambdaCodeReader({
    configResolver: async () => ({}),
    lambdaFactory: () => ({
      async send() {
        return { Configuration: { CodeSize: 999 * 1024 * 1024 }, Code: { Location: 'https://example.com/big.zip' } };
      },
    }),
    fetchImpl: async () => { throw new Error('must not download an oversized package'); },
  });

  const result = await reader.analyze({ profileId: 'local:dev', region: 'us-east-1', functionName: 'huge-fn' });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'package_too_large');
});

test('createAwsLambdaCodeReader requires a functionName', async () => {
  const reader = createAwsLambdaCodeReader({ configResolver: async () => ({}) });
  await assert.rejects(
    reader.analyze({ profileId: 'local:dev', region: 'us-east-1' }),
    error => error.statusCode === 400,
  );
});
