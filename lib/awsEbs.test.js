'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { listVolumes, monthlyUsd, kubernetesOrigin } = require('./awsEbs');

class DescribeVolumesCommand { constructor(input) { this.input = input; } }

test('lists every page of volumes and sums what unattached ones cost', async () => {
  const pages = [
    { Volumes: [
      { VolumeId: 'vol-1', Size: 5, VolumeType: 'gp2', State: 'available', Tags: [
        { Key: 'kubernetes.io/created-for/pvc/name', Value: 'postgres-data-planificador-postgres-0' },
        { Key: 'kubernetes.io/created-for/pvc/namespace', Value: 'backend-libros' },
        { Key: 'kubernetes.io/created-for/pv/name', Value: 'pvc-17f9' },
        { Key: 'kubernetes.io/cluster/EKS130-360-Dev', Value: 'owned' },
      ] },
      { VolumeId: 'vol-2', Size: 20, VolumeType: 'gp3', State: 'in-use', Attachments: [{ InstanceId: 'i-1', Device: '/dev/xvda', State: 'attached' }], Tags: [{ Key: 'Name', Value: 'root' }] },
    ], NextToken: 'next' },
    { Volumes: [{ VolumeId: 'vol-3', Size: 100, VolumeType: 'st1', State: 'available' }] },
  ];
  const sent = [];
  const client = { async send(command) { sent.push(command.input); return pages[sent.length - 1]; } };
  const result = await listVolumes(client, { DescribeVolumesCommand });
  assert.equal(sent[1].NextToken, 'next');
  assert.deepEqual(result.volumes.map(volume => [volume.id, volume.name, volume.unattached, volume.attachedTo]), [
    ['vol-1', 'vol-1', true, null], ['vol-2', 'root', false, 'i-1'], ['vol-3', 'vol-3', true, null],
  ]);
  assert.deepEqual(result.volumes[0].kubernetes, { cluster: 'EKS130-360-Dev', namespace: 'backend-libros', pvc: 'postgres-data-planificador-postgres-0', pv: 'pvc-17f9' });
  assert.deepEqual(result.summary, { total: 3, unattached: 2, unattachedGb: 105, unattachedMonthlyUsd: 5, monthlyUsd: 6.6 });
  assert.equal(result.truncated, false);
});

test('prices follow the volume type, including provisioned IOPS and throughput', () => {
  assert.equal(monthlyUsd({ VolumeType: 'gp2', Size: 5 }), 0.5);
  assert.equal(monthlyUsd({ VolumeType: 'gp3', Size: 100, Iops: 3000, Throughput: 125 }), 8);
  assert.equal(monthlyUsd({ VolumeType: 'gp3', Size: 100, Iops: 4000, Throughput: 225 }), 17);
  assert.equal(monthlyUsd({ VolumeType: 'io2', Size: 10, Iops: 100 }), 7.75);
  assert.equal(monthlyUsd({ VolumeType: 'unknown', Size: 10 }), null);
  assert.equal(kubernetesOrigin([{ Key: 'Name', Value: 'x' }]), null);
});
