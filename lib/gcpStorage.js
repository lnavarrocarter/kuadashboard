'use strict';
// Cloud Storage rows. publicAccessPrevention is a guard against future public
// grants, not a measure of exposure: "inherited" buckets may be private and
// may be protected by an organization policy. Real exposure needs the bucket
// IAM policy (allUsers / allAuthenticatedUsers) and ACLs, which this list does
// not read, so it is reported as not verified instead of guessed.

function publicAccessPrevention(bucket = {}) {
  const value = bucket.iamConfiguration?.publicAccessPrevention;
  if (value === 'enforced') return 'enforced';
  if (value === 'inherited' || value === 'unspecified') return 'inherited';
  return 'unknown';
}

function mapBucket(b = {}) {
  return {
    name:                   b.name,
    location:               b.location,
    storageClass:           b.storageClass,
    created:                b.timeCreated,
    publicAccessPrevention: publicAccessPrevention(b),
    uniformAccess:          typeof b.iamConfiguration?.uniformBucketLevelAccess?.enabled === 'boolean'
      ? b.iamConfiguration.uniformBucketLevelAccess.enabled
      : null,
    exposure:               'not_verified',
  };
}

module.exports = { publicAccessPrevention, mapBucket };
