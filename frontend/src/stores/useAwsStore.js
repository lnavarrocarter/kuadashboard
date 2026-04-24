/**
 * stores/useAwsStore.js
 * Pinia store for Amazon Web Services resources.
 *
 * All API calls inject X-Profile-Id from the activeProfileId state.
 * Desktop-ready: apiFetch can be replaced by an Electron IPC adapter.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '../composables/useApi'

export const useAwsStore = defineStore('aws', () => {
  const { apiFetch } = useApi()

  // ─── State ──────────────────────────────────────────────────────────────────
  const activeProfileId  = ref(null)
  const regions          = ref([])
  const eksClusters      = ref([])
  const ecsServices      = ref([])
  const ec2Instances     = ref([])
  const lambdas          = ref([])
  const apiGateways      = ref([])
  const s3Buckets        = ref([])
  const ecrRepos         = ref([])
  const vpcs             = ref([])
  const eventBridgeRules = ref([])
  const stepFunctions    = ref([])
  // New services
  const glueJobs         = ref([])
  const glueDatabases    = ref([])
  const docdbClusters    = ref([])
  const dynamoTables     = ref([])
  const athenaWorkgroups = ref([])
  const cloudfrontDists  = ref([])
  const route53Zones     = ref([])
  const cognitoUserPools = ref([])
  const secrets          = ref([])
  const dataPipelines    = ref([])
  const bedrockModels    = ref([])
  const lexBots          = ref([])
  const cfnStacks        = ref([])
  const loading          = ref(false)
  const error            = ref(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function headers() {
    if (!activeProfileId.value) throw new Error('No AWS profile selected')
    return { 'X-Profile-Id': activeProfileId.value }
  }

  function setError(e) { error.value = e.message }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function setActiveProfile(id) {
    activeProfileId.value  = id
    regions.value          = []
    eksClusters.value      = []
    ecsServices.value      = []
    ec2Instances.value     = []
    lambdas.value          = []
    apiGateways.value      = []
    s3Buckets.value        = []
    ecrRepos.value         = []
    vpcs.value             = []
    eventBridgeRules.value = []
    stepFunctions.value    = []
    glueJobs.value         = []
    glueDatabases.value    = []
    docdbClusters.value    = []
    dynamoTables.value     = []
    athenaWorkgroups.value = []
    cloudfrontDists.value  = []
    route53Zones.value     = []
    cognitoUserPools.value = []
    secrets.value          = []
    dataPipelines.value    = []
    bedrockModels.value    = []
    lexBots.value          = []
    cfnStacks.value        = []
  }

  async function fetchRegions() {
    loading.value = true; error.value = null
    try {
      regions.value = await apiFetch('/api/cloud/aws/regions', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEksClusters() {
    loading.value = true; error.value = null
    try {
      eksClusters.value = await apiFetch('/api/cloud/aws/eks', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEcsServices() {
    loading.value = true; error.value = null
    try {
      ecsServices.value = await apiFetch('/api/cloud/aws/ecs', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function startEcsService(cluster, service) {
    try {
      return await apiFetch(`/api/cloud/aws/ecs/${cluster}/${service}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function stopEcsService(cluster, service) {
    try {
      return await apiFetch(`/api/cloud/aws/ecs/${cluster}/${service}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchEc2Instances() {
    loading.value = true; error.value = null
    try {
      ec2Instances.value = await apiFetch('/api/cloud/aws/ec2', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function startEc2Instance(id) {
    try {
      return await apiFetch(`/api/cloud/aws/ec2/${id}/start`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function stopEc2Instance(id) {
    try {
      return await apiFetch(`/api/cloud/aws/ec2/${id}/stop`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchLambdas() {
    loading.value = true; error.value = null
    try {
      lambdas.value = await apiFetch('/api/cloud/aws/lambda', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function invokeLambda(name, payload = {}) {
    try {
      return await apiFetch(`/api/cloud/aws/lambda/${encodeURIComponent(name)}/invoke`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchApiGateways() {
    loading.value = true; error.value = null
    try {
      apiGateways.value = await apiFetch('/api/cloud/aws/apigateway', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchLogs(type, name, cluster = null, minutes = 60) {
    try {
      const url = type === 'lambda'
        ? `/api/cloud/aws/logs/lambda/${encodeURIComponent(name)}?minutes=${minutes}`
        : `/api/cloud/aws/logs/ecs/${encodeURIComponent(cluster)}/${encodeURIComponent(name)}?minutes=${minutes}`
      return await apiFetch(url, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchS3Buckets() {
    loading.value = true; error.value = null
    try {
      s3Buckets.value = await apiFetch('/api/cloud/aws/s3', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEcrRepos() {
    loading.value = true; error.value = null
    try {
      ecrRepos.value = await apiFetch('/api/cloud/aws/ecr', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchVpcs() {
    loading.value = true; error.value = null
    try {
      vpcs.value = await apiFetch('/api/cloud/aws/vpc', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchEventBridgeRules() {
    loading.value = true; error.value = null
    try {
      eventBridgeRules.value = await apiFetch('/api/cloud/aws/eventbridge', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchStepFunctions() {
    loading.value = true; error.value = null
    try {
      stepFunctions.value = await apiFetch('/api/cloud/aws/stepfunctions', { headers: headers() })
    } catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchStepFnDiagram(arn) {
    try {
      return await apiFetch(`/api/cloud/aws/stepfunctions/config?arn=${encodeURIComponent(arn)}`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchEventBridgeConfig(bus, rule) {
    try {
      return await apiFetch(`/api/cloud/aws/eventbridge/config?bus=${encodeURIComponent(bus)}&rule=${encodeURIComponent(rule)}`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchEventBridgeLogs(bus, rule, minutes = 60) {
    try {
      return await apiFetch(
        `/api/cloud/aws/logs/eventbridge?bus=${encodeURIComponent(bus)}&rule=${encodeURIComponent(rule)}&minutes=${minutes}`,
        { headers: headers() }
      )
    } catch (e) { setError(e); return null }
  }

  async function fetchResourceConfig(service, params) {
    const h = headers()
    try {
      switch (service) {
        case 'ec2':
          return await apiFetch(`/api/cloud/aws/ec2/${params.id}/config`, { headers: h })
        case 'ecs':
          return await apiFetch(`/api/cloud/aws/ecs/${params.cluster}/${params.name}/config`, { headers: h })
        case 'eks':
          return await apiFetch(`/api/cloud/aws/eks/${encodeURIComponent(params.name)}/config`, { headers: h })
        case 'lambda':
          return await apiFetch(`/api/cloud/aws/lambda/${encodeURIComponent(params.name)}/config`, { headers: h })
        case 's3':
          return await apiFetch(`/api/cloud/aws/s3/${encodeURIComponent(params.bucket)}/config`, { headers: h })
        case 'ecr':
          return await apiFetch(`/api/cloud/aws/ecr/config?repo=${encodeURIComponent(params.repo)}`, { headers: h })
        case 'vpc':
          return await apiFetch(`/api/cloud/aws/vpc/${params.id}/config`, { headers: h })
        case 'eventbridge':
          return await apiFetch(`/api/cloud/aws/eventbridge/config?bus=${encodeURIComponent(params.bus)}&rule=${encodeURIComponent(params.name)}`, { headers: h })
        case 'stepfn':
          return await apiFetch(`/api/cloud/aws/stepfunctions/config?arn=${encodeURIComponent(params.arn)}`, { headers: h })
        case 'apigateway':
          return await apiFetch(`/api/cloud/aws/apigateway/${params.id}/config?type=${encodeURIComponent(params.type || 'REST')}`, { headers: h })
        case 'dynamodb':
          return await apiFetch(`/api/cloud/aws/dynamodb/${encodeURIComponent(params.table)}/config`, { headers: h })
        case 'glue':
          return await apiFetch(`/api/cloud/aws/glue/jobs/${encodeURIComponent(params.name)}/config`, { headers: h })
        case 'secrets':
          return await apiFetch(`/api/cloud/aws/secrets/${encodeURIComponent(params.name)}/config`, { headers: h })
        case 'cloudfront':
          return await apiFetch(`/api/cloud/aws/cloudfront/${encodeURIComponent(params.id)}/config`, { headers: h })
        default:
          throw new Error(`Unknown service: ${service}`)
      }
    } catch (e) { setError(e); return null }
  }

  async function fetchTags(service, arn) {
    try {
      return await apiFetch(`/api/cloud/aws/tags?service=${encodeURIComponent(service)}&arn=${encodeURIComponent(arn)}`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function saveTags(service, arn, tags, removedKeys = []) {
    try {
      return await apiFetch('/api/cloud/aws/tags', {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ arn, service, tags, removedKeys }),
      })
    } catch (e) { setError(e); return null }
  }

  async function enableLambdaLogging(name, logFormat = 'Text', retentionDays = 30) {
    try {
      return await apiFetch(`/api/cloud/aws/lambda/${encodeURIComponent(name)}/logging`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ logFormat, retentionDays }),
      })
    } catch (e) { setError(e); return null }
  }

  async function enableEcsLogging(cluster, service, retentionDays = 30, logPrefix) {
    try {
      return await apiFetch(`/api/cloud/aws/ecs/${encodeURIComponent(cluster)}/${encodeURIComponent(service)}/logging`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays, logPrefix }),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchApigwIntegrations(id, type) {
    try {
      return await apiFetch(`/api/cloud/aws/apigateway/${encodeURIComponent(id)}/integrations?type=${encodeURIComponent(type)}`, {
        headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function addEksKubeconfig(name) {
    try {
      return await apiFetch(`/api/cloud/aws/eks/${encodeURIComponent(name)}/add-kubeconfig`, {
        method: 'POST',
        headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchS3Objects(bucket, prefix, continuationToken) {
    try {
      let url = `/api/cloud/aws/s3/${encodeURIComponent(bucket)}/browse?prefix=${encodeURIComponent(prefix || '')}`
      if (continuationToken) url += `&continuationToken=${encodeURIComponent(continuationToken)}`
      return await apiFetch(url, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchS3ObjectContent(bucket, key) {
    try {
      return await apiFetch(`/api/cloud/aws/s3/${encodeURIComponent(bucket)}/object?key=${encodeURIComponent(key)}`, {
        headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function createS3Bucket(name, region = 'us-east-1', blockPublicAccess = true) {
    try {
      return await apiFetch('/api/cloud/aws/s3', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, region, blockPublicAccess }),
      })
    } catch (e) { setError(e); return null }
  }

  async function testS3Bucket(bucket) {
    try {
      return await apiFetch(`/api/cloud/aws/s3/${encodeURIComponent(bucket)}/test`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchEcrImages(repo) {
    try {
      return await apiFetch(`/api/cloud/aws/ecr/${encodeURIComponent(repo)}/images`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function applyK8sManifest(manifest, context) {
    try {
      return await apiFetch('/api/cloud/aws/k8s/apply', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest, context }),
      })
    } catch (e) { setError(e); return null }
  }

  // ─── Glue ────────────────────────────────────────────────────────────────────

  async function fetchGlueJobs() {
    loading.value = true; error.value = null
    try { glueJobs.value = await apiFetch('/api/cloud/aws/glue/jobs', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchGlueDatabases() {
    loading.value = true; error.value = null
    try { glueDatabases.value = await apiFetch('/api/cloud/aws/glue/databases', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function runGlueJob(name, args = {}) {
    try {
      return await apiFetch(`/api/cloud/aws/glue/jobs/${encodeURIComponent(name)}/run`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: args }),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchGlueJobRuns(name) {
    try {
      return await apiFetch(`/api/cloud/aws/glue/jobs/${encodeURIComponent(name)}/runs`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchGlueJobConfig(name) {
    try {
      return await apiFetch(`/api/cloud/aws/glue/jobs/${encodeURIComponent(name)}/config`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchGlueConnections() {
    try {
      return await apiFetch('/api/cloud/aws/glue/connections', { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchGlueLogs(name, { minutes = 60, runId } = {}) {
    try {
      const q = new URLSearchParams({ minutes })
      if (runId) q.set('runId', runId)
      return await apiFetch(`/api/cloud/aws/glue/logs/${encodeURIComponent(name)}?${q}`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  // ─── DocumentDB ──────────────────────────────────────────────────────────────

  async function fetchDocdbClusters() {
    loading.value = true; error.value = null
    try { docdbClusters.value = await apiFetch('/api/cloud/aws/docdb', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchDocdbConnectionStrings(clusterId) {
    try {
      return await apiFetch(`/api/cloud/aws/docdb/${encodeURIComponent(clusterId)}/connection-strings`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchDocdbConfig(clusterId) {
    try {
      return await apiFetch(`/api/cloud/aws/docdb/${encodeURIComponent(clusterId)}/config`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function resetDocdbPassword(clusterId, newPassword) {
    try {
      return await apiFetch(`/api/cloud/aws/docdb/${encodeURIComponent(clusterId)}/reset-password`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
    } catch (e) { setError(e); return null }
  }

  async function createDocdbCluster(params) {
    try {
      return await apiFetch('/api/cloud/aws/docdb', {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
    } catch (e) { setError(e); return null }
  }

  // ─── DynamoDB ────────────────────────────────────────────────────────────────

  async function fetchDynamoTables() {
    loading.value = true; error.value = null
    try { dynamoTables.value = await apiFetch('/api/cloud/aws/dynamodb', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchDynamoTableConfig(table) {
    try {
      return await apiFetch(`/api/cloud/aws/dynamodb/${encodeURIComponent(table)}/config`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function scanDynamoTable(table, { limit = 50, exclusiveStartKey } = {}) {
    try {
      return await apiFetch(`/api/cloud/aws/dynamodb/${encodeURIComponent(table)}/scan`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, exclusiveStartKey }),
      })
    } catch (e) { setError(e); return null }
  }

  async function queryDynamoTable(table, params) {
    try {
      return await apiFetch(`/api/cloud/aws/dynamodb/${encodeURIComponent(table)}/query`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
    } catch (e) { setError(e); return null }
  }

  // ─── Athena ──────────────────────────────────────────────────────────────────

  async function fetchAthenaWorkgroups() {
    loading.value = true; error.value = null
    try { athenaWorkgroups.value = await apiFetch('/api/cloud/aws/athena/workgroups', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchAthenaCatalogs() {
    try {
      return await apiFetch('/api/cloud/aws/athena/databases', { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function startAthenaQuery(query, workgroup, outputLocation) {
    try {
      return await apiFetch('/api/cloud/aws/athena/query', {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, workgroup, outputLocation }),
      })
    } catch (e) { setError(e); return null }
  }

  async function getAthenaQueryResult(id) {
    try {
      return await apiFetch(`/api/cloud/aws/athena/query/${encodeURIComponent(id)}`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  // ─── CloudFront ──────────────────────────────────────────────────────────────

  async function fetchCloudfrontDists() {
    loading.value = true; error.value = null
    try { cloudfrontDists.value = await apiFetch('/api/cloud/aws/cloudfront', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function invalidateCloudfront(id, paths = ['/*']) {
    try {
      return await apiFetch(`/api/cloud/aws/cloudfront/${encodeURIComponent(id)}/invalidate`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchCloudfrontConfig(id) {
    try {
      return await apiFetch(`/api/cloud/aws/cloudfront/${encodeURIComponent(id)}/config`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchCloudfrontStats(id) {
    try {
      return await apiFetch(`/api/cloud/aws/cloudfront/${encodeURIComponent(id)}/stats`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function createCloudfrontFromS3({ bucketName, region, comment = '', priceClass = 'PriceClass_100', aliases = [] }) {
    try {
      return await apiFetch('/api/cloud/aws/cloudfront', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketName, region, comment, priceClass, aliases }),
      })
    } catch (e) { setError(e); return null }
  }

  // ─── Route 53 ────────────────────────────────────────────────────────────────

  async function fetchRoute53Zones() {
    loading.value = true; error.value = null
    try { route53Zones.value = await apiFetch('/api/cloud/aws/route53/zones', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchRoute53Records(zoneId) {
    try {
      return await apiFetch(`/api/cloud/aws/route53/zones/${encodeURIComponent(zoneId)}/records`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  // ─── Cognito ─────────────────────────────────────────────────────────────────

  async function fetchCognitoUserPools() {
    loading.value = true; error.value = null
    try { cognitoUserPools.value = await apiFetch('/api/cloud/aws/cognito/userpools', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchCognitoPoolConfig(poolId) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/config`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchCognitoUsers(poolId, { limit = 60, paginationToken, filter } = {}) {
    try {
      const q = new URLSearchParams({ limit })
      if (paginationToken) q.set('paginationToken', paginationToken)
      if (filter)          q.set('filter', filter)
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users?${q}`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchCognitoUserDetail(poolId, username) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users/${encodeURIComponent(username)}`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function createCognitoUser(poolId, userData) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(userData),
      })
    } catch (e) { setError(e); return null }
  }

  async function resetCognitoUserPassword(poolId, username) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users/${encodeURIComponent(username)}/reset-password`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function setCognitoUserPassword(poolId, username, password, permanent = true) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users/${encodeURIComponent(username)}/set-password`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, permanent }),
      })
    } catch (e) { setError(e); return null }
  }

  async function enableCognitoUser(poolId, username) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users/${encodeURIComponent(username)}/enable`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function disableCognitoUser(poolId, username) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users/${encodeURIComponent(username)}/disable`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function deleteCognitoUser(poolId, username) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/users/${encodeURIComponent(username)}`, {
        method: 'DELETE', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function fetchCognitoClients(poolId) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/clients`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchCognitoIdentityProviders(poolId) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/identity-providers`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function fetchCognitoGroups(poolId) {
    try {
      return await apiFetch(`/api/cloud/aws/cognito/userpools/${encodeURIComponent(poolId)}/groups`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  // ─── Secrets Manager ─────────────────────────────────────────────────────────

  async function fetchSecrets() {
    loading.value = true; error.value = null
    try { secrets.value = await apiFetch('/api/cloud/aws/secrets', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function fetchSecretConfig(name) {
    try {
      return await apiFetch(`/api/cloud/aws/secrets/${encodeURIComponent(name)}/config`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function importSecretToProfile(secretName, targetProfileId = null, targetProfileName = null) {
    try {
      return await apiFetch(`/api/cloud/aws/secrets/${encodeURIComponent(secretName)}/import-to-profile`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProfileId, targetProfileName }),
      })
    } catch (e) { setError(e); return null }
  }

  async function previewSecretKeys(secretName) {
    try {
      return await apiFetch(`/api/cloud/aws/secrets/${encodeURIComponent(secretName)}/preview-keys`, { headers: headers() })
    } catch (e) { setError(e); return null }
  }

  async function importSelectedSecretKeys(secretName, selectedKeys, targetProfileId = null, targetProfileName = null) {
    try {
      return await apiFetch(`/api/cloud/aws/secrets/${encodeURIComponent(secretName)}/import-selected`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedKeys, targetProfileId, targetProfileName }),
      })
    } catch (e) { setError(e); return null }
  }

  // ─── Data Pipeline ───────────────────────────────────────────────────────────

  async function fetchDataPipelines() {
    loading.value = true; error.value = null
    try { dataPipelines.value = await apiFetch('/api/cloud/aws/datapipeline', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  async function activateDataPipeline(id) {
    try {
      return await apiFetch(`/api/cloud/aws/datapipeline/${encodeURIComponent(id)}/activate`, {
        method: 'POST', headers: headers(),
      })
    } catch (e) { setError(e); return null }
  }

  async function deactivateDataPipeline(id) {
    try {
      return await apiFetch(`/api/cloud/aws/datapipeline/${encodeURIComponent(id)}/deactivate`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelActive: true }),
      })
    } catch (e) { setError(e); return null }
  }

  // ─── Bedrock ────────────────────────────────────────────────────────────────

  async function fetchBedrockModels() {
    loading.value = true; error.value = null
    try { bedrockModels.value = await apiFetch('/api/cloud/aws/bedrock', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  // ─── Amazon Lex ─────────────────────────────────────────────────────────────

  async function fetchLexBots() {
    loading.value = true; error.value = null
    try { lexBots.value = await apiFetch('/api/cloud/aws/lex', { headers: headers() }) }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  // ─── CloudFormation (AgentCore) ────────────────────────────────────────────

  async function fetchCloudformationStacks(agentCoreOnly = false) {
    loading.value = true; error.value = null
    try {
      const q = agentCoreOnly ? '?agentCoreOnly=true' : ''
      cfnStacks.value = await apiFetch(`/api/cloud/aws/cloudformation/stacks${q}`, { headers: headers() })
    }
    catch (e) { setError(e) } finally { loading.value = false }
  }

  return {
    activeProfileId, regions, eksClusters, ecsServices, ec2Instances,
    lambdas, apiGateways, s3Buckets, ecrRepos, vpcs, eventBridgeRules, stepFunctions,
    glueJobs, glueDatabases, docdbClusters, dynamoTables, athenaWorkgroups,
    cloudfrontDists, route53Zones, cognitoUserPools, secrets, dataPipelines,
    bedrockModels, lexBots, cfnStacks,
    loading, error,
    setActiveProfile,
    fetchRegions, fetchEksClusters,
    fetchEcsServices, startEcsService, stopEcsService,
    fetchEc2Instances, startEc2Instance, stopEc2Instance,
    fetchLambdas, invokeLambda,
    fetchApiGateways,
    fetchLogs,
    fetchS3Buckets, fetchEcrRepos, fetchVpcs, fetchEventBridgeRules, fetchStepFunctions, fetchStepFnDiagram, fetchEventBridgeConfig, fetchEventBridgeLogs,
    fetchResourceConfig,
    fetchTags, saveTags,
    enableLambdaLogging, enableEcsLogging,
    fetchApigwIntegrations, addEksKubeconfig, fetchS3Objects, fetchS3ObjectContent,
    // New services
    fetchGlueJobs, fetchGlueDatabases, runGlueJob, fetchGlueJobRuns,
    fetchGlueJobConfig, fetchGlueConnections, fetchGlueLogs,
    fetchDocdbClusters, fetchDocdbConnectionStrings, fetchDocdbConfig, resetDocdbPassword, createDocdbCluster,
    fetchDynamoTables, fetchDynamoTableConfig, scanDynamoTable, queryDynamoTable,
    fetchAthenaWorkgroups, fetchAthenaCatalogs, startAthenaQuery, getAthenaQueryResult,
    fetchCloudfrontDists, invalidateCloudfront,
    fetchCloudfrontConfig, fetchCloudfrontStats, createCloudfrontFromS3,
    fetchRoute53Zones, fetchRoute53Records,
    fetchCognitoUserPools, fetchCognitoPoolConfig,
    fetchCognitoUsers, fetchCognitoUserDetail, createCognitoUser,
    resetCognitoUserPassword, setCognitoUserPassword,
    enableCognitoUser, disableCognitoUser, deleteCognitoUser,
    fetchCognitoClients, fetchCognitoIdentityProviders, fetchCognitoGroups,
    fetchSecrets, fetchSecretConfig, importSecretToProfile, previewSecretKeys, importSelectedSecretKeys,
    fetchDataPipelines, activateDataPipeline, deactivateDataPipeline,
    fetchBedrockModels, fetchLexBots, fetchCloudformationStacks,
    createS3Bucket, testS3Bucket, fetchEcrImages, applyK8sManifest,
  }
})
