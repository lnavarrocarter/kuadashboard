'use strict';
/**
 * lib/awsEbs.js
 * EBS volumes for the AWS view: what each volume is, what it is attached to, the Kubernetes claim
 * that created it (from the tags the EBS CSI driver writes), and what it costs per month at list
 * price. Only DescribeVolumes, which AWS does not charge for.
 */

// USD per GB-month (and per provisioned IOPS / MB/s where AWS charges it), us-east-1 list prices.
// Most regions match; a few charge slightly more. Snapshots are not included.
const PRICES = {
  gp3: { gb: 0.08, iopsFree: 3000, iops: 0.005, throughputFree: 125, throughput: 0.04 },
  gp2: { gb: 0.10 },
  io1: { gb: 0.125, iops: 0.065 },
  io2: { gb: 0.125, iops: 0.065 },
  st1: { gb: 0.045 },
  sc1: { gb: 0.015 },
  standard: { gb: 0.05 },
};

function monthlyUsd(volume) {
  const price = PRICES[volume.VolumeType];
  if (!price) return null;
  const size = Number(volume.Size) || 0;
  let usd = size * price.gb;
  if (price.iops && volume.Iops) usd += Math.max(0, volume.Iops - (price.iopsFree || 0)) * price.iops;
  if (price.throughput && volume.Throughput) usd += Math.max(0, volume.Throughput - (price.throughputFree || 0)) * price.throughput;
  return Math.round(usd * 100) / 100;
}

/** The Kubernetes claim and cluster a volume was created for, from the CSI driver tags. */
function kubernetesOrigin(tags = []) {
  const value = key => tags.find(tag => tag.Key === key)?.Value || null;
  const pvc = value('kubernetes.io/created-for/pvc/name');
  const clusterTag = tags.find(tag => /^kubernetes\.io\/cluster\//.test(tag.Key || ''));
  const cluster = value('KubernetesCluster') || (clusterTag ? clusterTag.Key.replace('kubernetes.io/cluster/', '') : null);
  if (!pvc && !cluster) return null;
  return {
    cluster,
    namespace: value('kubernetes.io/created-for/pvc/namespace'),
    pvc,
    pv: value('kubernetes.io/created-for/pv/name'),
  };
}

function mapVolume(volume) {
  const tags = volume.Tags || [];
  const attachments = (volume.Attachments || []).map(attachment => ({
    instanceId: attachment.InstanceId || null,
    device: attachment.Device || null,
    state: attachment.State || null,
    deleteOnTermination: attachment.DeleteOnTermination ?? null,
  }));
  return {
    id: volume.VolumeId,
    name: tags.find(tag => tag.Key === 'Name')?.Value || volume.VolumeId,
    size: volume.Size ?? null,
    type: volume.VolumeType || null,
    iops: volume.Iops ?? null,
    throughput: volume.Throughput ?? null,
    state: volume.State || null,
    az: volume.AvailabilityZone || null,
    encrypted: !!volume.Encrypted,
    createdAt: volume.CreateTime ? new Date(volume.CreateTime).toISOString() : null,
    snapshotId: volume.SnapshotId || null,
    attachments,
    attachedTo: attachments[0]?.instanceId || null,
    // Available = attached to nothing: it is still billed every month.
    unattached: volume.State === 'available',
    kubernetes: kubernetesOrigin(tags),
    monthlyUsd: monthlyUsd(volume),
    tags,
  };
}

/** Every volume of the region (DescribeVolumes pages of 500), and a summary of the unattached ones. */
async function listVolumes(client, { DescribeVolumesCommand, maxPages = 20 } = {}) {
  const volumes = [];
  let NextToken;
  let pages = 0;
  do {
    const response = await client.send(new DescribeVolumesCommand({ NextToken, MaxResults: 500 }));
    volumes.push(...(response.Volumes || []).map(mapVolume));
    NextToken = response.NextToken;
    pages += 1;
  } while (NextToken && pages < maxPages);
  const unattached = volumes.filter(volume => volume.unattached);
  return {
    volumes,
    truncated: !!NextToken,
    summary: {
      total: volumes.length,
      unattached: unattached.length,
      unattachedGb: unattached.reduce((total, volume) => total + (Number(volume.size) || 0), 0),
      unattachedMonthlyUsd: Math.round(unattached.reduce((total, volume) => total + (volume.monthlyUsd || 0), 0) * 100) / 100,
      monthlyUsd: Math.round(volumes.reduce((total, volume) => total + (volume.monthlyUsd || 0), 0) * 100) / 100,
    },
  };
}

module.exports = { listVolumes, mapVolume, monthlyUsd, kubernetesOrigin, EBS_PRICES: PRICES };
