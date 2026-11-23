'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCloudFormationYaml } = require('./cloudFormationYaml');
const yaml = require('./yaml');

test('CloudFormation short forms become their long JSON form as scalars, sequences and mappings', () => {
  const template = parseCloudFormationYaml(`AWSTemplateFormatVersion: "2010-09-09"
Transform: !Transform {Name: AWS::Include, Parameters: {Location: s3://b/k}}
Resources:
  Bucket:
    Type: AWS::S3::Bucket
    Condition: IsProd
    Properties:
      BucketName: !Sub "\${AWS::StackName}-data"
      Tags:
        - Key: Arn
          Value: !GetAtt Role.Arn
        - Key: Joined
          Value: !Join ["-", [!Ref Env, !Select [0, !GetAZs ""]]]
        - Key: Mapped
          Value: !Sub ["\${Name}", {Name: !ImportValue shared-name}]
        - Key: Prod
          Value: !If [IsProd, !Condition IsProd, !Ref AWS::NoValue]
`);
  assert.deepEqual(template.Transform, { 'Fn::Transform': { Name: 'AWS::Include', Parameters: { Location: 's3://b/k' } } });
  const tags = Object.fromEntries(template.Resources.Bucket.Properties.Tags.map(tag => [tag.Key, tag.Value]));
  assert.deepEqual(template.Resources.Bucket.Properties.BucketName, { 'Fn::Sub': '${AWS::StackName}-data' });
  assert.deepEqual(tags.Arn, { 'Fn::GetAtt': 'Role.Arn' });
  assert.deepEqual(tags.Joined, { 'Fn::Join': ['-', [{ Ref: 'Env' }, { 'Fn::Select': [0, { 'Fn::GetAZs': '' }] }]] });
  assert.deepEqual(tags.Mapped, { 'Fn::Sub': ['${Name}', { Name: { 'Fn::ImportValue': 'shared-name' } }] });
  assert.deepEqual(tags.Prod, { 'Fn::If': ['IsProd', { Condition: 'IsProd' }, { Ref: 'AWS::NoValue' }] });
});

test('YAML merge keys keep resolving, as they did before js-yaml 5', () => {
  const source = 'base: &base {cpu: 1, memory: 2}\npod: {<<: *base, memory: 4}\n';
  assert.deepEqual(yaml.load(source).pod, { cpu: 1, memory: 4 });
  assert.deepEqual(parseCloudFormationYaml(source).pod, { cpu: 1, memory: 4 });
});

test('unquoted timestamps load as strings instead of Dates', () => {
  assert.equal(yaml.load('created: 2024-01-01T00:00:00Z').created, '2024-01-01T00:00:00Z');
});
