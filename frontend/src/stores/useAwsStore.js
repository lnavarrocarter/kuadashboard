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

  return {
    activeProfileId, regions, eksClusters, ecsServices, ec2Instances,
    lambdas, apiGateways, s3Buckets, ecrRepos, vpcs, eventBridgeRules, stepFunctions,
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
  }
})
