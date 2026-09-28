// Confirmation config for start / stop / delete on Cloud Run, Compute VMs and
// Cloud SQL (used by GcpView with GcpConfirmModal).
//
// Safety layers:
//   - start: resumes billing → cost estimate + "this generates costs" checkbox
//   - stop:  plain confirmation listing what keeps billing / side effects
//   - delete: irreversible → typed resource name; blocked outright when the
//     resource has deletion protection (GCP would reject it anyway)

const KIND_LABEL = { cloudrun: 'servicio Cloud Run', vm: 'VM', sql: 'instancia Cloud SQL' }

function startConfig(kind, r) {
  const base = { tone: 'warning', costAck: true, confirmLabel: 'Iniciar' }
  if (kind === 'cloudrun') return {
    ...base,
    title: `Iniciar ${r.name}`,
    message: 'Fija min instances = 1 para mantener una instancia caliente.',
    lines: ['La instancia queda encendida 24/7 y se factura aunque no reciba tráfico.'],
    estimateKind: 'cloudrun',
    estimateSpec: { cpu: r.cpu || '1', memory: r.memory || '512Mi', minInstances: 1 },
  }
  if (kind === 'vm') return {
    ...base,
    title: `Iniciar VM ${r.name}`,
    message: 'La VM vuelve a facturar cómputo desde que arranca.',
    lines: [`Zona ${r.zone} · ${r.machineType}`, 'Si la IP externa es efímera, puede cambiar al iniciar.'],
    estimateKind: 'vm',
    estimateSpec: {
      machineType: r.machineType,
      diskSizeGb: r.diskSizeGb || 10,
      externalIp: !!r.externalIp,
      spot: r.provisioningModel === 'SPOT' || r.provisioningModel === 'PREEMPTIBLE',
    },
  }
  return {
    ...base,
    title: `Iniciar ${r.name}`,
    message: 'La instancia vuelve a facturar cada hora que esté encendida.',
    lines: [`${r.database || ''} · ${r.tier || ''}`.trim()],
    estimateKind: 'sql',
    estimateSpec: {
      tier: r.tier,
      storageGb: r.storageGb || 10,
      storageType: r.storageType || 'PD_SSD',
      availabilityType: r.availabilityType || 'ZONAL',
    },
  }
}

function stopConfig(kind, r) {
  const base = { tone: 'info', confirmLabel: 'Detener' }
  if (kind === 'cloudrun') return {
    ...base,
    title: `Detener ${r.name}`,
    message: 'Fija min instances = 0: el servicio escala a cero cuando no hay tráfico.',
    lines: ['La URL sigue activa; la primera petición tendrá un arranque en frío.'],
  }
  if (kind === 'vm') return {
    ...base,
    title: `Detener VM ${r.name}`,
    message: 'Se apaga la VM (equivale a apagarla, no a suspenderla).',
    lines: [
      'Los procesos en ejecución se detienen; los datos en disco se conservan.',
      'Los discos y las IPs estáticas siguen facturando mientras esté detenida.',
      r.externalIp ? 'Si la IP externa es efímera, puede cambiar al volver a iniciar.' : null,
    ].filter(Boolean),
  }
  return {
    ...base,
    title: `Detener ${r.name}`,
    message: 'La instancia deja de aceptar conexiones.',
    lines: ['El almacenamiento y las IPs siguen facturando mientras esté detenida.'],
  }
}

function deleteConfig(kind, r) {
  const base = {
    tone: 'danger',
    title: `Eliminar ${KIND_LABEL[kind]} ${r.name}`,
    message: 'Esta acción no se puede deshacer.',
    requireName: r.name,
    confirmLabel: 'Eliminar definitivamente',
  }
  if (kind === 'cloudrun') return {
    ...base,
    lines: ['Se eliminan todas las revisiones y la URL deja de responder.', 'Los contenedores en Artifact Registry no se eliminan.'],
  }
  if (kind === 'vm') {
    const kept = r.keptDiskCount || 0
    return {
      ...base,
      lines: [
        'Se elimina la VM y los discos marcados con auto-delete.',
        kept ? `${kept} disco(s) sin auto-delete se conservan y seguirán facturando.` : null,
        r.externalIp ? 'La IP externa efímera se libera.' : null,
      ].filter(Boolean),
      blocked: r.deletionProtection ? 'La VM tiene protección contra eliminación. Desactívala en la consola de Google Cloud para poder eliminarla.' : '',
    }
  }
  return {
    ...base,
    lines: [
      'Se eliminan todas las bases de datos, usuarios y backups automáticos de la instancia.',
      'La eliminación continúa en segundo plano durante unos minutos.',
    ],
    blocked: r.deletionProtection ? 'La instancia tiene protección contra eliminación. Desactívala en la consola de Google Cloud para poder eliminarla.' : '',
  }
}

export function gcpActionConfig(kind, action, resource) {
  if (!KIND_LABEL[kind]) throw new Error(`Unknown GCP resource kind: ${kind}`)
  if (action === 'start') return startConfig(kind, resource)
  if (action === 'stop') return stopConfig(kind, resource)
  if (action === 'delete') return deleteConfig(kind, resource)
  throw new Error(`Unknown GCP action: ${action}`)
}
