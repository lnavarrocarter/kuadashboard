'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const k8s = require('@kubernetes/client-node');

function kubeConfigPaths(homeDirectory = os.homedir()) {
  return {
    mergedKubeconfig: path.join(homeDirectory, '.kube', 'kuadashboard_merged.yaml'),
    defaultKubeconfig: path.join(homeDirectory, '.kube', 'config'),
    registeredPaths: path.join(homeDirectory, '.kube', 'kuadashboard_paths.json'),
  };
}

function mergeKubeConfigs(destination, source) {
  source.clusters.forEach(item => {
    if (!destination.clusters.find(existing => existing.name === item.name)) destination.clusters.push(item);
  });
  source.users.forEach(item => {
    if (!destination.users.find(existing => existing.name === item.name)) destination.users.push(item);
  });
  source.contexts.forEach(item => {
    if (!destination.contexts.find(existing => existing.name === item.name)) destination.contexts.push(item);
  });
}

function readRegisteredKubeconfigPaths({
  fileSystem = fs,
  homeDirectory = os.homedir(),
} = {}) {
  const { registeredPaths } = kubeConfigPaths(homeDirectory);
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(registeredPaths, 'utf8'));
    return Array.isArray(parsed.paths) ? parsed.paths.filter(item => typeof item === 'string') : [];
  } catch (_) {
    return [];
  }
}

function resolveKubeConfigFiles({
  environment = process.env,
  fileSystem = fs,
  homeDirectory = os.homedir(),
} = {}) {
  const { defaultKubeconfig } = kubeConfigPaths(homeDirectory);
  const separator = process.platform === 'win32' ? ';' : ':';
  const environmentFiles = environment.KUBECONFIG
    ? environment.KUBECONFIG.split(separator).map(item => item.trim()).filter(item => item && fileSystem.existsSync(item))
    : [];
  const files = [...environmentFiles];
  if (!files.includes(defaultKubeconfig) && fileSystem.existsSync(defaultKubeconfig)) files.push(defaultKubeconfig);
  for (const file of readRegisteredKubeconfigPaths({ fileSystem, homeDirectory })) {
    if (!files.includes(file) && fileSystem.existsSync(file)) files.push(file);
  }
  return files;
}

function buildKubeConfig(contextName, {
  environment = process.env,
  fileSystem = fs,
  homeDirectory = os.homedir(),
  KubeConfig = k8s.KubeConfig,
  logger = console,
} = {}) {
  const kubeConfig = new KubeConfig();
  const files = resolveKubeConfigFiles({ environment, fileSystem, homeDirectory });
  const loaded = [];

  if (!files.length) {
    kubeConfig.loadFromDefault();
    loaded.push('(default discovery)');
  } else {
    kubeConfig.loadFromFile(files[0]);
    loaded.push(files[0]);
    for (let index = 1; index < files.length; index += 1) {
      try {
        const extra = new KubeConfig();
        extra.loadFromFile(files[index]);
        mergeKubeConfigs(kubeConfig, extra);
        loaded.push(files[index]);
      } catch (error) {
        logger.warn(`[warn] Could not load ${files[index]}:`, error.message);
      }
    }
  }

  const { mergedKubeconfig } = kubeConfigPaths(homeDirectory);
  if (fileSystem.existsSync(mergedKubeconfig)) {
    try {
      const extra = new KubeConfig();
      extra.loadFromFile(mergedKubeconfig);
      mergeKubeConfigs(kubeConfig, extra);
      loaded.push(mergedKubeconfig);
    } catch (error) {
      logger.warn('[warn] Could not load merged kubeconfig:', error.message);
    }
  }

  if (contextName) kubeConfig.setCurrentContext(contextName);
  let context = kubeConfig.getCurrentContext();
  if (!context && kubeConfig.getContexts().length) {
    context = kubeConfig.getContexts()[0].name;
    kubeConfig.setCurrentContext(context);
  }

  return { kubeConfig, context, loaded };
}

module.exports = {
  buildKubeConfig,
  kubeConfigPaths,
  mergeKubeConfigs,
  readRegisteredKubeconfigPaths,
  resolveKubeConfigFiles,
};