'use strict';
// Artifact Registry repository rows. The listing itself is regional and lives
// in lib/gcpLocations (ListRepositories rejects "locations/-").

function mapRepository(r = {}) {
  return {
    name:        r.name?.split('/').pop(),
    location:    r.name?.split('/')[3],
    format:      r.format,
    description: r.description || '',
    created:     r.createTime,
    updated:     r.updateTime,
    sizeBytes:   r.sizeBytes ? parseInt(r.sizeBytes, 10) : null,
  };
}

module.exports = { mapRepository };
