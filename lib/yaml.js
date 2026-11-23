'use strict';

const yaml = require('js-yaml');

// js-yaml 5 loads with CORE_SCHEMA, which no longer resolves `<<` merge keys
// the way 4.x's default schema did. Kubeconfigs and manifests written with
// anchors and merges must keep working, so load with merges enabled.
const SCHEMA = yaml.CORE_SCHEMA.withTags(yaml.mergeTag);

function load(source, options = {}) {
  return yaml.load(source, { schema: SCHEMA, ...options });
}

module.exports = { load, dump: yaml.dump, SCHEMA };
