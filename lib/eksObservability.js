'use strict';

const GROUP_DIMENSIONS = {
  namespace: 'Namespace',
  service:   'Service',
  pod:       'PodName',
  node:      'NodeName',
};

const METRIC_DEFINITIONS = {
  pod_cpu_utilization: {
    label: 'CPU', unit: '%', statistic: 'Average', aggregate: 'average', groups: ['namespace', 'pod'],
  },
  pod_memory_utilization: {
    label: 'Memory', unit: '%', statistic: 'Average', aggregate: 'average', groups: ['namespace', 'pod'],
  },
  pod_number_of_container_restarts: {
    label: 'Container restarts', unit: 'count', statistic: 'Maximum', aggregate: 'sum', groups: ['namespace', 'pod'],
  },
  pod_network_rx_bytes: {
    label: 'Network received', unit: 'bytes', statistic: 'Sum', aggregate: 'sum', groups: ['namespace', 'pod'],
  },
  pod_network_tx_bytes: {
    label: 'Network sent', unit: 'bytes', statistic: 'Sum', aggregate: 'sum', groups: ['namespace', 'pod'],
  },
  namespace_number_of_running_pods: {
    label: 'Running pods', unit: 'count', statistic: 'Average', aggregate: 'sum', groups: ['namespace'],
  },
  service_number_of_running_pods: {
    label: 'Running pods', unit: 'count', statistic: 'Average', aggregate: 'sum', groups: ['service'],
  },
  node_cpu_utilization: {
    label: 'CPU', unit: '%', statistic: 'Average', aggregate: 'average', groups: ['node'],
  },
  node_memory_utilization: {
    label: 'Memory', unit: '%', statistic: 'Average', aggregate: 'average', groups: ['node'],
  },
  node_filesystem_utilization: {
    label: 'Filesystem', unit: '%', statistic: 'Average', aggregate: 'average', groups: ['node'],
  },
  node_network_total_bytes: {
    label: 'Network', unit: 'bytes', statistic: 'Sum', aggregate: 'sum', groups: ['node'],
  },
};

function dimensionsObject(dimensions = []) {
  return Object.fromEntries(dimensions.map(dimension => [dimension.Name, dimension.Value]));
}

function buildMetricQueries(metrics, groupBy, period, maxQueries = 450) {
  const groupDimension = GROUP_DIMENSIONS[groupBy];
  if (!groupDimension) throw new Error(`Unsupported EKS metric grouping: ${groupBy}`);

  const seen = new Set();
  const descriptors = [];
  for (const metric of metrics || []) {
    const definition = METRIC_DEFINITIONS[metric.MetricName];
    if (!definition?.groups.includes(groupBy)) continue;

    const dimensions = dimensionsObject(metric.Dimensions);
    const group = dimensions[groupDimension];
    if (!group) continue;

    const dimensionKey = (metric.Dimensions || [])
      .map(dimension => `${dimension.Name}=${dimension.Value}`)
      .sort()
      .join('|');
    const key = `${metric.MetricName}|${dimensionKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const id = `m${descriptors.length}`;
    descriptors.push({
      id,
      group,
      metricName: metric.MetricName,
      definition,
      query: {
        Id: id,
        ReturnData: true,
        MetricStat: {
          Metric: {
            Namespace: 'ContainerInsights',
            MetricName: metric.MetricName,
            Dimensions: metric.Dimensions || [],
          },
          Period: period,
          Stat: definition.statistic,
        },
      },
    });
    if (descriptors.length >= maxQueries) break;
  }
  return descriptors;
}

function aggregateSeries(seriesList, aggregate) {
  const valuesByTimestamp = new Map();
  for (const series of seriesList) {
    for (const point of series) {
      const timestamp = new Date(point.t).toISOString();
      const values = valuesByTimestamp.get(timestamp) || [];
      values.push(Number(point.v) || 0);
      valuesByTimestamp.set(timestamp, values);
    }
  }

  return [...valuesByTimestamp.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([t, values]) => ({
      t,
      v: aggregate === 'average'
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : values.reduce((sum, value) => sum + value, 0),
    }));
}

function aggregateMetricResults(descriptors, results = []) {
  const resultById = new Map(results.map(result => [result.Id, result]));
  const groupedSeries = new Map();

  for (const descriptor of descriptors) {
    const result = resultById.get(descriptor.id);
    if (!result?.Values?.length) continue;
    const series = result.Values.map((value, index) => ({
      t: result.Timestamps?.[index],
      v: value,
    })).filter(point => point.t);
    if (!series.length) continue;

    const key = `${descriptor.group}\u0000${descriptor.metricName}`;
    const entry = groupedSeries.get(key) || { descriptor, series: [] };
    entry.series.push(series);
    groupedSeries.set(key, entry);
  }

  const groups = new Map();
  for (const { descriptor, series } of groupedSeries.values()) {
    const group = groups.get(descriptor.group) || { name: descriptor.group, metrics: {} };
    const points = aggregateSeries(series, descriptor.definition.aggregate);
    group.metrics[descriptor.metricName] = {
      label: descriptor.definition.label,
      unit: descriptor.definition.unit,
      points,
      latest: points.at(-1)?.v ?? null,
    };
    groups.set(descriptor.group, group);
  }

  const groupList = [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
  const metricNames = [...new Set(descriptors.map(descriptor => descriptor.metricName))];
  const summary = {};
  for (const metricName of metricNames) {
    const definition = METRIC_DEFINITIONS[metricName];
    const series = groupList
      .map(group => group.metrics[metricName]?.points)
      .filter(Boolean);
    if (!series.length) continue;
    const points = aggregateSeries(series, definition.aggregate);
    summary[metricName] = {
      label: definition.label,
      unit: definition.unit,
      points,
      latest: points.at(-1)?.v ?? null,
    };
  }

  return { groups: groupList, summary };
}

module.exports = {
  GROUP_DIMENSIONS,
  METRIC_DEFINITIONS,
  aggregateMetricResults,
  buildMetricQueries,
};