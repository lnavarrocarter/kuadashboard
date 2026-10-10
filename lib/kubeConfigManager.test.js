'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildKubeConfig, resolveKubeConfigFiles } = require('./kubeConfigManager');

class FakeKubeConfig {
  constructor() {
    this.clusters = [];
    this.users = [];
    this.contexts = [];
    this.currentContext = '';
  }

  loadFromFile(file) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.clusters = value.clusters || [];
    this.users = value.users || [];
    this.contexts = value.contexts || [];
    this.currentContext = value.currentContext || '';
  }

  loadFromDefault() {}
  setCurrentContext(context) { this.currentContext = context; }
  getCurrentContext() { return this.currentContext; }
  getContexts() { return this.contexts; }
}

function writeConfig(file, name, currentContext = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    clusters: [{ name: `${name}-cluster` }],
    users: [{ name: `${name}-user` }],
    contexts: [{ name, cluster: `${name}-cluster`, user: `${name}-user` }],
    currentContext,
  }));
}

test('resolves environment, default and registered kubeconfig files once', () => {
  const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-kube-config-'));
  try {
    const environmentFile = path.join(homeDirectory, 'environment.json');
    const defaultFile = path.join(homeDirectory, '.kube', 'config');
    const registeredFile = path.join(homeDirectory, 'registered.json');
    writeConfig(environmentFile, 'environment');
    writeConfig(defaultFile, 'default');
    writeConfig(registeredFile, 'registered');
    fs.writeFileSync(path.join(homeDirectory, '.kube', 'kuadashboard_paths.json'), JSON.stringify({
      paths: [environmentFile, registeredFile],
    }));
    assert.deepEqual(resolveKubeConfigFiles({
      homeDirectory,
      environment: { KUBECONFIG: environmentFile },
    }), [environmentFile, defaultFile, registeredFile]);
  } finally {
    fs.rmSync(homeDirectory, { recursive: true, force: true });
  }
});

test('builds independent kubeconfig instances for background collection', () => {
  const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-kube-isolated-'));
  try {
    const defaultFile = path.join(homeDirectory, '.kube', 'config');
    const mergedFile = path.join(homeDirectory, '.kube', 'kuadashboard_merged.yaml');
    writeConfig(defaultFile, 'visible', 'visible');
    writeConfig(mergedFile, 'background');

    const visible = buildKubeConfig(null, { homeDirectory, environment: {}, KubeConfig: FakeKubeConfig });
    const background = buildKubeConfig('background', { homeDirectory, environment: {}, KubeConfig: FakeKubeConfig });

    assert.notEqual(visible.kubeConfig, background.kubeConfig);
    assert.equal(visible.context, 'visible');
    assert.equal(background.context, 'background');
    assert.equal(visible.kubeConfig.getCurrentContext(), 'visible');
    assert.deepEqual(background.kubeConfig.getContexts().map(item => item.name), ['visible', 'background']);
  } finally {
    fs.rmSync(homeDirectory, { recursive: true, force: true });
  }
});
test('starts without clusters when KUBECONFIG names a file that no longer exists', () => {
  const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-kube-missing-'));
  class BrokenDefault extends FakeKubeConfig {
    loadFromDefault() { throw new Error('ENOENT: no such file or directory'); }
    loadFromOptions(options) { Object.assign(this, options); }
  }
  const warnings = []
  try {
    const result = buildKubeConfig(null, {
      homeDirectory,
      environment: { KUBECONFIG: path.join(homeDirectory, 'gone.yaml') },
      KubeConfig: BrokenDefault,
      logger: { warn: message => warnings.push(message), log() {} },
    });
    assert.deepEqual(result.kubeConfig.getContexts(), []);
    assert.match(warnings.join('\n'), /starting without clusters/);
  } finally {
    fs.rmSync(homeDirectory, { recursive: true, force: true });
  }
});
