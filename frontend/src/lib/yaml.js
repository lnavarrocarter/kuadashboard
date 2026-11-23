import { CORE_SCHEMA, mergeTag, load as loadYaml, dump } from 'js-yaml'

// js-yaml 5 loads with CORE_SCHEMA, which no longer resolves `<<` merge keys
// the way 4.x's default schema did. Manifests written with anchors and merges
// must keep working, so load with merges enabled.
const SCHEMA = CORE_SCHEMA.withTags(mergeTag)

export function load(source, options = {}) {
  return loadYaml(source, { schema: SCHEMA, ...options })
}

export { dump }
