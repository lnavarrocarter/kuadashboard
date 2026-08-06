'use strict';

const {
  CloudFormationClient,
  ListStacksCommand,
  ListStackResourcesCommand,
} = require('@aws-sdk/client-cloudformation');
const {
  ECSClient,
  ListServicesCommand,
  DescribeServicesCommand,
} = require('@aws-sdk/client-ecs');
const { resolveAwsConfig } = require('../awsProfileResolver');
const { deploymentResources, ecsServiceResource } = require('./deploymentDiscovery');

const ACTIVE_STACK_STATUSES = [
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE',
  'UPDATE_ROLLBACK_COMPLETE',
  'IMPORT_COMPLETE',
  'IMPORT_ROLLBACK_COMPLETE',
];
const MAX_STACKS = 10;

function accountFromStackId(stackId) {
  return String(stackId || '').split(':')[4] || '';
}

function createAwsDeploymentReader({
  configResolver = resolveAwsConfig,
  cloudFormationFactory = config => new CloudFormationClient(config),
  ecsFactory = config => new ECSClient(config),
} = {}) {
  async function clients(profileId, region) {
    const config = { ...await configResolver(profileId), region };
    return {
      cloudFormation: cloudFormationFactory(config),
      ecs: ecsFactory(config),
    };
  }

  return {
    async listDeployments({ profileId, region }) {
      const { cloudFormation } = await clients(profileId, region);
      const deployments = [];
      let nextToken;
      let requests = 0;
      do {
        const response = await cloudFormation.send(new ListStacksCommand({
          StackStatusFilter: ACTIVE_STACK_STATUSES,
          NextToken: nextToken,
        }));
        requests += 1;
        deployments.push(...(response.StackSummaries || []).map(stack => ({
          id: stack.StackId,
          name: stack.StackName,
          status: stack.StackStatus,
          updatedAt: stack.LastUpdatedTime || stack.CreationTime || null,
        })));
        nextToken = response.NextToken;
      } while (nextToken);
      deployments.sort((left, right) => left.name.localeCompare(right.name));
      return {
        scope: { profileId, region, accountId: accountFromStackId(deployments[0]?.id) },
        estimate: { awsRequests: requests, kubernetesRequests: 0 },
        deployments,
      };
    },

    async preview({ profileId, region, stackNames }) {
      if (!Array.isArray(stackNames) || !stackNames.length || stackNames.length > MAX_STACKS) {
        throw Object.assign(new Error(`Select between 1 and ${MAX_STACKS} deployments`), { statusCode: 400 });
      }
      const { cloudFormation, ecs } = await clients(profileId, region);
      const resources = [];
      let requests = 0;
      for (const stackName of [...new Set(stackNames)]) {
        let nextToken;
        const summaries = [];
        do {
          const response = await cloudFormation.send(new ListStackResourcesCommand({ StackName: stackName, NextToken: nextToken }));
          requests += 1;
          summaries.push(...(response.StackResourceSummaries || []));
          nextToken = response.NextToken;
        } while (nextToken);
        resources.push(...deploymentResources(stackName, summaries));

        const clusters = summaries.filter(summary => summary.ResourceType === 'AWS::ECS::Cluster');
        for (const cluster of clusters) {
          let serviceToken;
          const serviceArns = [];
          do {
            const response = await ecs.send(new ListServicesCommand({
              cluster: cluster.PhysicalResourceId,
              nextToken: serviceToken,
            }));
            requests += 1;
            serviceArns.push(...(response.serviceArns || []));
            serviceToken = response.nextToken;
          } while (serviceToken);
          for (let index = 0; index < serviceArns.length; index += 10) {
            const response = await ecs.send(new DescribeServicesCommand({
              cluster: cluster.PhysicalResourceId,
              services: serviceArns.slice(index, index + 10),
            }));
            requests += 1;
            for (const service of response.services || []) {
              const resource = ecsServiceResource(stackName, cluster.PhysicalResourceId, service);
              if (resource) resources.push(resource);
            }
          }
        }
      }
      const uniqueResources = [...new Map(resources.map(resource => [resource.key, resource])).values()];
      return {
        estimate: { awsRequests: requests, kubernetesRequests: 0 },
        resources: uniqueResources,
      };
    },
  };
}

module.exports = { ACTIVE_STACK_STATUSES, MAX_STACKS, createAwsDeploymentReader };