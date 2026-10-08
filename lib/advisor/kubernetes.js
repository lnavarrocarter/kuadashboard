'use strict';
/**
 * lib/advisor/kubernetes.js
 * Good-practice checks for the Kubernetes Overview, from the objects the
 * overview already lists (pods, workloads, nodes) plus NetworkPolicies,
 * PodDisruptionBudgets and HPAs. Pure: no I/O.
 *
 * Sources are settled results ({ ok, value } | { ok: false, error }); a
 * failed source skips its checks and is reported as unavailable. kube-*
 * namespaces are skipped: they belong to the platform, not to the team.
 */

const { check, buildReport, isFloatingImage, SECRET_NAME_RE } = require('./core');

const DOCS = {
  podSecurity: 'https://kubernetes.io/docs/concepts/security/pod-security-standards/',
  securityContext: 'https://kubernetes.io/docs/tasks/configure-pod-container/security-context/',
  secrets: 'https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets-as-environment-variables',
  networkPolicy: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/',
  serviceAccount: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#opt-out-of-api-credential-automounting',
  resources: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/',
  versionSkew: 'https://kubernetes.io/releases/version-skew-policy/',
  pdb: 'https://kubernetes.io/docs/tasks/run-application/configure-pdb/',
  spread: 'https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/',
  hpa: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/',
  probes: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/',
  images: 'https://kubernetes.io/docs/concepts/containers/images/#image-names',
  labels: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/',
  namespaces: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/',
  crashLoop: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/',
};

const RULES = {
  privileged: { id: 'k8s.privileged', category: 'security', severity: 'high', docs: DOCS.podSecurity },
  hostNamespaces: { id: 'k8s.host_namespaces', category: 'security', severity: 'high', docs: DOCS.podSecurity },
  plainSecretEnv: { id: 'k8s.plain_secret_env', category: 'security', severity: 'high', docs: DOCS.secrets },
  hostPath: { id: 'k8s.host_path', category: 'security', severity: 'medium', docs: DOCS.podSecurity },
  runAsRoot: { id: 'k8s.run_as_root', category: 'security', severity: 'medium', docs: DOCS.securityContext },
  noNetworkPolicy: { id: 'k8s.no_network_policy', category: 'security', severity: 'medium', docs: DOCS.networkPolicy },
  privilegeEscalation: { id: 'k8s.privilege_escalation', category: 'security', severity: 'low', docs: DOCS.securityContext },
  defaultServiceAccount: { id: 'k8s.default_service_account', category: 'security', severity: 'low', docs: DOCS.serviceAccount },
  saturation: { id: 'k8s.cluster_saturation', category: 'infrastructure', severity: 'high', docs: DOCS.resources },
  noRequests: { id: 'k8s.no_requests', category: 'infrastructure', severity: 'medium', docs: DOCS.resources },
  noMemoryLimit: { id: 'k8s.no_memory_limit', category: 'infrastructure', severity: 'medium', docs: DOCS.resources },
  kubeletSkew: { id: 'k8s.kubelet_skew', category: 'infrastructure', severity: 'low', docs: DOCS.versionSkew },
  overprovisioned: { id: 'k8s.cluster_overprovisioned', category: 'infrastructure', severity: 'low', docs: DOCS.resources },
  singleNode: { id: 'k8s.single_node', category: 'architecture', severity: 'medium', docs: DOCS.spread },
  singleReplica: { id: 'k8s.single_replica', category: 'architecture', severity: 'medium', docs: DOCS.hpa },
  barePods: { id: 'k8s.bare_pods', category: 'architecture', severity: 'medium', docs: DOCS.pdb },
  noPdb: { id: 'k8s.no_pdb', category: 'architecture', severity: 'low', docs: DOCS.pdb },
  noSpread: { id: 'k8s.no_spread', category: 'architecture', severity: 'low', docs: DOCS.spread },
  defaultNamespace: { id: 'k8s.default_namespace', category: 'architecture', severity: 'low', docs: DOCS.namespaces },
  crashLoops: { id: 'k8s.crash_loops', category: 'development', severity: 'high', docs: DOCS.crashLoop },
  clusterAdminBinding: { id: 'k8s.cluster_admin_binding', category: 'security', severity: 'high', docs: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/#user-facing-roles' },
  noPodSecurityAdmission: { id: 'k8s.no_pod_security_admission', category: 'security', severity: 'medium', docs: 'https://kubernetes.io/docs/concepts/security/pod-security-admission/' },
  widelyMountedSecret: { id: 'k8s.secret_many_pods', category: 'security', severity: 'medium', docs: DOCS.secrets },
  floatingImage: { id: 'k8s.latest_tag', category: 'development', severity: 'medium', docs: DOCS.images },
  noReadiness: { id: 'k8s.no_readiness', category: 'development', severity: 'medium', docs: DOCS.probes },
  noLiveness: { id: 'k8s.no_liveness', category: 'development', severity: 'low', docs: DOCS.probes },
  missingLabels: { id: 'k8s.missing_labels', category: 'development', severity: 'low', docs: DOCS.labels },
};

const RESTART_THRESHOLD = 10;
const SATURATION_PERCENT = 85;
const IDLE_PERCENT = 25;
const SECRET_WORKLOAD_THRESHOLD = 10;

function isPlatformNamespace(namespace) {
  return /^kube-/.test(String(namespace || ''));
}

// Identities the control plane and managed services bind to cluster-admin by
// default (the bootstrap "cluster-admin" binding to system:masters, EKS add-on
// managers…): not something the team granted.
function isPlatformSubject(subject = {}) {
  const name = String(subject.name || '');
  if (/^(system|eks):/.test(name)) return true;
  return subject.kind === 'ServiceAccount' && isPlatformNamespace(subject.namespace);
}

const KIND_LABELS = { deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet' };

/**
 * Workloads to check: controllers plus bare pods. Pods owned by a controller
 * are covered by their template; Job pods are skipped (short-lived).
 */
function collectWorkloads(sources) {
  const workloads = [];
  for (const kind of Object.keys(KIND_LABELS)) {
    for (const item of (sources[kind]?.ok ? sources[kind].value : [])) {
      if (isPlatformNamespace(item.metadata?.namespace)) continue;
      workloads.push({
        kind: KIND_LABELS[kind],
        name: item.metadata?.name,
        namespace: item.metadata?.namespace,
        labels: item.metadata?.labels || {},
        podLabels: item.spec?.template?.metadata?.labels || {},
        replicas: kind === 'daemonsets' ? null : (item.spec?.replicas ?? 1),
        spec: item.spec?.template?.spec || {},
      });
    }
  }
  for (const pod of (sources.pods?.ok ? sources.pods.value : [])) {
    if (isPlatformNamespace(pod.metadata?.namespace)) continue;
    if ((pod.metadata?.ownerReferences || []).length) continue;
    if (pod.metadata?.annotations?.['kubernetes.io/config.mirror']) continue;
    workloads.push({
      kind: 'Pod',
      name: pod.metadata?.name,
      namespace: pod.metadata?.namespace,
      labels: pod.metadata?.labels || {},
      podLabels: pod.metadata?.labels || {},
      replicas: null,
      bare: true,
      spec: pod.spec || {},
    });
  }
  return workloads;
}

const ref = (workload, detail) => ({ kind: workload.kind, name: workload.name, namespace: workload.namespace, ...(detail ? { detail } : {}) });

function containersOf(spec) {
  return spec.containers || [];
}

/** The workload a pod belongs to: Deployment (through its ReplicaSet), StatefulSet, Job… or the pod itself. */
function podWorkload(pod) {
  const owner = (pod.metadata?.ownerReferences || []).find(ref => ref.controller) || pod.metadata?.ownerReferences?.[0];
  if (!owner) return `Pod/${pod.metadata?.name}`;
  // A ReplicaSet created by a Deployment is named <deployment>-<pod-template-hash>.
  if (owner.kind === 'ReplicaSet') return `Deployment/${String(owner.name).replace(/-[a-z0-9]{6,10}$/, '')}`;
  return `${owner.kind}/${owner.name}`;
}

function secretPodReferences(pods = []) {
  const references = new Map();
  for (const pod of pods) {
    const namespace = pod.metadata?.namespace || '';
    if (isPlatformNamespace(namespace)) continue;
    const workload = podWorkload(pod);
    const names = new Set();
    for (const volume of pod.spec?.volumes || []) {
      if (volume.secret?.secretName) names.add(volume.secret.secretName);
      for (const source of volume.projected?.sources || []) if (source.secret?.name) names.add(source.secret.name);
    }
    for (const container of [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])]) {
      for (const source of container.envFrom || []) if (source.secretRef?.name) names.add(source.secretRef.name);
      for (const variable of container.env || []) if (variable.valueFrom?.secretKeyRef?.name) names.add(variable.valueFrom.secretKeyRef.name);
    }
    for (const name of names) {
      const key = `${namespace}/${name}`;
      const entry = references.get(key) || { namespace, name, workloads: new Set() };
      entry.workloads.add(workload);
      references.set(key, entry);
    }
  }
  return [...references.values()].filter(entry => entry.workloads.size > SECRET_WORKLOAD_THRESHOLD)
    .map(entry => ({ kind: 'Secret', name: entry.name, namespace: entry.namespace, detail: `${entry.workloads.size} workloads` }));
}

/** Workloads with at least one container matching `predicate`; detail lists the containers. */
function withContainers(workloads, predicate) {
  return workloads
    .map(workload => {
      const names = containersOf(workload.spec).filter(c => predicate(c, workload.spec)).map(c => c.name);
      return names.length ? ref(workload, names.join(', ')) : null;
    })
    .filter(Boolean);
}

function runsAsRoot(container, podSpec) {
  const pod = podSpec.securityContext || {};
  const own = container.securityContext || {};
  const nonRoot = own.runAsNonRoot ?? pod.runAsNonRoot;
  const user = own.runAsUser ?? pod.runAsUser;
  if (user === 0) return true;
  return !(nonRoot === true || (Number.isInteger(user) && user > 0));
}

function plainSecretEnvNames(container) {
  return (container.env || [])
    .filter(env => SECRET_NAME_RE.test(env.name || '') && typeof env.value === 'string' && env.value.length > 0)
    .map(env => env.name);
}

function selectorMatches(selector = {}, labels = {}) {
  const matchLabels = Object.entries(selector.matchLabels || {});
  const expressions = selector.matchExpressions || [];
  if (!matchLabels.length && !expressions.length) return false;
  if (!matchLabels.every(([key, value]) => labels[key] === value)) return false;
  return expressions.every(expr => {
    const has = Object.prototype.hasOwnProperty.call(labels, expr.key);
    if (expr.operator === 'In') return has && (expr.values || []).includes(labels[expr.key]);
    if (expr.operator === 'NotIn') return !has || !(expr.values || []).includes(labels[expr.key]);
    if (expr.operator === 'Exists') return has;
    if (expr.operator === 'DoesNotExist') return !has;
    return false;
  });
}

function hasSpread(spec) {
  return (spec.topologySpreadConstraints || []).length > 0
    || (spec.affinity?.podAntiAffinity?.requiredDuringSchedulingIgnoredDuringExecution || []).length > 0
    || (spec.affinity?.podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution || []).length > 0;
}

function sourceError(source, result) {
  const err = result?.error;
  const status = err?.statusCode || err?.response?.statusCode || err?.code;
  return { source, error: String(err?.body?.message || err?.message || err || 'unavailable').slice(0, 300), ...(status ? { status } : {}) };
}

/**
 * @param sources settled lists: pods, nodes, deployments, statefulsets, daemonsets,
 *                networkPolicies, pdbs, hpas
 * @param usage   nodes usage summary from buildOverview (cpu/memory percent) or null
 */
function adviseKubernetes({ sources = {}, usage = null, namespace = 'all', now = Date.now() } = {}) {
  const results = [];
  const unavailable = [];
  for (const [name, result] of Object.entries(sources)) {
    if (result && !result.ok) unavailable.push(sourceError(name, result));
  }
  const workloadSources = ['deployments', 'statefulsets', 'daemonsets', 'pods'];
  const haveWorkloads = workloadSources.some(kind => sources[kind]?.ok);
  const workloads = collectWorkloads(sources);

  if (haveWorkloads) {
    // Security
    results.push(check(RULES.privileged, withContainers(workloads, c => c.securityContext?.privileged === true)));
    results.push(check(RULES.hostNamespaces, workloads
      .filter(w => w.spec.hostNetwork || w.spec.hostPID || w.spec.hostIPC)
      .map(w => ref(w, ['hostNetwork', 'hostPID', 'hostIPC'].filter(key => w.spec[key]).join(', ')))));
    results.push(check(RULES.plainSecretEnv, workloads
      .map(w => {
        const names = containersOf(w.spec).flatMap(plainSecretEnvNames);
        return names.length ? ref(w, [...new Set(names)].join(', ')) : null;
      })));
    results.push(check(RULES.hostPath, workloads
      .filter(w => (w.spec.volumes || []).some(v => v.hostPath))
      .map(w => ref(w, (w.spec.volumes || []).filter(v => v.hostPath).map(v => v.hostPath.path).join(', ')))));
    results.push(check(RULES.runAsRoot, withContainers(workloads, runsAsRoot)));
    results.push(check(RULES.privilegeEscalation, withContainers(workloads, c => c.securityContext?.allowPrivilegeEscalation !== false && c.securityContext?.privileged !== true)));
    results.push(check(RULES.defaultServiceAccount, workloads
      .filter(w => (!w.spec.serviceAccountName || w.spec.serviceAccountName === 'default') && w.spec.automountServiceAccountToken !== false)
      .map(w => ref(w))));

    // Infrastructure
    results.push(check(RULES.noRequests, withContainers(workloads, c => !c.resources?.requests?.cpu || !c.resources?.requests?.memory)));
    results.push(check(RULES.noMemoryLimit, withContainers(workloads, c => !c.resources?.limits?.memory)));

    // Architecture
    const hpas = sources.hpas?.ok ? sources.hpas.value : [];
    const scaledBy = workload => hpas.find(hpa => hpa.metadata?.namespace === workload.namespace
      && hpa.spec?.scaleTargetRef?.name === workload.name
      && hpa.spec?.scaleTargetRef?.kind === workload.kind);
    results.push(check(RULES.singleReplica, workloads
      .filter(w => w.replicas === 1 && (w.kind === 'Deployment' || w.kind === 'StatefulSet'))
      .filter(w => !((scaledBy(w)?.spec?.minReplicas ?? 1) > 1))
      .map(w => ref(w))));
    results.push(check(RULES.barePods, workloads.filter(w => w.bare).map(w => ref(w))));
    if (sources.pdbs?.ok) {
      const pdbs = sources.pdbs.value;
      results.push(check(RULES.noPdb, workloads
        .filter(w => (w.replicas || 0) > 1)
        .filter(w => !pdbs.some(pdb => pdb.metadata?.namespace === w.namespace && selectorMatches(pdb.spec?.selector, w.podLabels)))
        .map(w => ref(w, `${w.replicas} replicas`))));
    }
    const nodeCount = sources.nodes?.ok ? sources.nodes.value.length : 0;
    if (nodeCount > 1) {
      results.push(check(RULES.noSpread, workloads
        .filter(w => (w.replicas || 0) > 1 && !hasSpread(w.spec))
        .map(w => ref(w, `${w.replicas} replicas`))));
    }
    results.push(check(RULES.defaultNamespace, workloads.filter(w => w.namespace === 'default').map(w => ref(w))));

    // Development
    results.push(check(RULES.floatingImage, workloads
      .map(w => {
        const images = containersOf(w.spec).map(c => c.image).filter(isFloatingImage);
        return images.length ? ref(w, images.join(', ')) : null;
      })));
    const servesTraffic = workloads.filter(w => w.kind === 'Deployment' || w.kind === 'StatefulSet');
    results.push(check(RULES.noReadiness, withContainers(servesTraffic, c => !c.readinessProbe)));
    results.push(check(RULES.noLiveness, withContainers(servesTraffic, c => !c.livenessProbe && !c.startupProbe)));
    results.push(check(RULES.missingLabels, workloads
      .filter(w => !w.bare)
      .filter(w => !w.labels['app.kubernetes.io/name'] && !w.labels.app)
      .map(w => ref(w))));
  }

  if (sources.pods?.ok) {
    results.push(check(RULES.crashLoops, sources.pods.value
      .filter(pod => !isPlatformNamespace(pod.metadata?.namespace))
      .map(pod => {
        const statuses = pod.status?.containerStatuses || [];
        const restarts = statuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);
        const crashing = statuses.some(c => c.state?.waiting?.reason === 'CrashLoopBackOff');
        return crashing || restarts >= RESTART_THRESHOLD
          ? { kind: 'Pod', name: pod.metadata?.name, namespace: pod.metadata?.namespace, detail: crashing ? `CrashLoopBackOff · ${restarts} restarts` : `${restarts} restarts` }
          : null;
      })));
  }

  if (sources.networkPolicies?.ok && haveWorkloads) {
    const covered = new Set(sources.networkPolicies.value.map(policy => policy.metadata?.namespace));
    const namespaces = [...new Set(workloads.map(w => w.namespace))].filter(ns => ns && !covered.has(ns)).sort();
    results.push(check(RULES.noNetworkPolicy, namespaces.map(ns => ({ kind: 'Namespace', name: ns }))));
  }

  const adminBindings = [];
  for (const [key, kind] of [['clusterRoleBindings', 'ClusterRoleBinding'], ['roleBindings', 'RoleBinding']]) {
    if (!sources[key]?.ok) continue;
    for (const binding of sources[key].value) {
      if (binding.roleRef?.kind !== 'ClusterRole' || binding.roleRef?.name !== 'cluster-admin') continue;
      if (kind === 'RoleBinding' && isPlatformNamespace(binding.metadata?.namespace)) continue;
      const subjects = (binding.subjects || []).filter(subject => !isPlatformSubject(subject));
      if (!subjects.length) continue;
      adminBindings.push({
        kind, name: binding.metadata?.name || 'unnamed binding',
        ...(binding.metadata?.namespace ? { namespace: binding.metadata.namespace } : {}),
        detail: subjects.map(subject => `${subject.kind}:${subject.name}`).join(', '),
      });
    }
  }
  if (sources.clusterRoleBindings?.ok || sources.roleBindings?.ok) results.push(check(RULES.clusterAdminBinding, adminBindings));

  if (sources.namespaces?.ok) {
    const psaLabels = ['enforce', 'audit', 'warn'].map(mode => `pod-security.kubernetes.io/${mode}`);
    results.push(check(RULES.noPodSecurityAdmission, sources.namespaces.value
      .filter(item => !isPlatformNamespace(item.metadata?.name))
      .filter(item => !psaLabels.some(label => Object.hasOwn(item.metadata?.labels || {}, label)))
      .map(item => ({ kind: 'Namespace', name: item.metadata?.name }))));
  }

  if (sources.pods?.ok) results.push(check(RULES.widelyMountedSecret, secretPodReferences(sources.pods.value), { workloads: SECRET_WORKLOAD_THRESHOLD }));

  if (sources.nodes?.ok) {
    const nodes = sources.nodes.value;
    const minors = new Map();
    for (const node of nodes) {
      const version = node.status?.nodeInfo?.kubeletVersion || '';
      const minor = (version.match(/^v?(\d+\.\d+)/) || [])[1];
      if (!minor) continue;
      if (!minors.has(minor)) minors.set(minor, []);
      minors.get(minor).push(node.metadata?.name);
    }
    results.push(check(RULES.kubeletSkew, minors.size > 1
      ? [...minors.entries()].map(([minor, names]) => ({ kind: 'Version', name: `v${minor}`, detail: `${names.length} node(s)` }))
      : []));
    // A one-node cluster is only an issue when the whole cluster is in scope.
    if (namespace === 'all') {
      results.push(check(RULES.singleNode, nodes.length === 1 ? [{ kind: 'Node', name: nodes[0].metadata?.name }] : []));
    }
  }

  if (usage) {
    const cpu = usage.cpu?.percent;
    const memory = usage.memory?.percent;
    const hot = [
      cpu >= SATURATION_PERCENT ? { kind: 'Resource', name: 'CPU', detail: `${cpu}%` } : null,
      memory >= SATURATION_PERCENT ? { kind: 'Resource', name: 'Memory', detail: `${memory}%` } : null,
    ];
    results.push(check(RULES.saturation, hot, { percent: SATURATION_PERCENT }));
    const nodeCount = sources.nodes?.ok ? sources.nodes.value.length : 0;
    const idle = nodeCount >= 3 && cpu != null && memory != null && cpu < IDLE_PERCENT && memory < IDLE_PERCENT;
    results.push(check(RULES.overprovisioned, idle ? [{ kind: 'Cluster', name: `${nodeCount} nodes`, detail: `CPU ${cpu}% · Memory ${memory}%` }] : [], { percent: IDLE_PERCENT }));
  }

  return buildReport(results, { unavailable, scope: { provider: 'kubernetes', namespace, excludes: 'kube-*' }, now });
}

module.exports = { adviseKubernetes, selectorMatches, runsAsRoot, secretPodReferences, RULES };
