'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapBucket } = require('./gcpStorage');

test('prevention is reported as enforced / inherited / unknown, never as "public"', () => {
  const enforced = mapBucket({ name: 'a', iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } } });
  const inherited = mapBucket({ name: 'b', iamConfiguration: { publicAccessPrevention: 'inherited', uniformBucketLevelAccess: { enabled: false } } });
  const legacy = mapBucket({ name: 'c', iamConfiguration: { publicAccessPrevention: 'unspecified' } });
  const missing = mapBucket({ name: 'd' });
  assert.equal(enforced.publicAccessPrevention, 'enforced');
  assert.equal(inherited.publicAccessPrevention, 'inherited');
  assert.equal(legacy.publicAccessPrevention, 'inherited');
  assert.equal(missing.publicAccessPrevention, 'unknown');
  assert.equal(enforced.uniformAccess, true);
  assert.equal(inherited.uniformAccess, false);
  assert.equal(missing.uniformAccess, null);
  for (const row of [enforced, inherited, legacy, missing]) {
    assert.equal(row.exposure, 'not_verified');
    assert.equal('publicAccess' in row, false);
  }
});
