'use strict';

const yaml = require('./yaml');
const jsYaml = require('js-yaml');

// CloudFormation intrinsic short forms (!Ref, !Sub…), each turned into its long
// JSON form so YAML templates read the same as JSON ones. Every tag is accepted
// as a scalar, a sequence or a mapping; CloudFormation validates the shape.
const TAGS = ['Ref', 'Condition', 'Base64', 'Cidr', 'FindInMap', 'GetAtt', 'GetAZs', 'ImportValue', 'Join', 'Select', 'Split', 'Sub', 'Transform', 'And', 'Equals', 'If', 'Not', 'Or'];

const longKey = tag => (tag === 'Ref' || tag === 'Condition' ? tag : `Fn::${tag}`);
const loadOnly = () => false;

function intrinsicTags(tag) {
  const key = longKey(tag);
  const name = `!${tag}`;
  return [
    jsYaml.defineScalarTag(name, { resolve: value => ({ [key]: value }), identify: loadOnly }),
    jsYaml.defineSequenceTag(name, {
      create: () => [],
      addItem: (items, item) => { items.push(item); },
      finalize: items => ({ [key]: items }),
      identify: loadOnly,
    }),
    jsYaml.defineMappingTag(name, {
      create: () => ({}),
      addPair: (map, pairKey, value) => { map[pairKey] = value; return ''; },
      has: (map, pairKey) => Object.hasOwn(map, pairKey),
      keys: result => Object.keys(result[key]),
      get: (result, pairKey) => result[key][pairKey],
      finalize: map => ({ [key]: map }),
      identify: loadOnly,
    }),
  ];
}

const SCHEMA = yaml.SCHEMA.withTags(TAGS.flatMap(intrinsicTags));

function parseCloudFormationYaml(body) {
  return jsYaml.load(body, { schema: SCHEMA });
}

module.exports = { parseCloudFormationYaml, SCHEMA };
