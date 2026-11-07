'use strict';

const { validateRecipeYaml } = require('./validate');

function shellQuote(value) {
  const text = String(value);
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function makeStep(id, label, argv, risk = null) {
  return { id, label, argv, display: argv.map(shellQuote).join(' '), risk, requiresConfirmation: true };
}

/**
 * Build a reviewable, inert plan. This module never invokes a shell or connects to Proxmox.
 * Any future executor must pass argv as an argument array and require explicit user approval.
 */
function generateRecipePlan(source, context = {}) {
  const validation = validateRecipeYaml(source, context);
  if (!validation.valid) {
    const error = Object.assign(new Error('Cannot plan an invalid Proxmox recipe'), { code: 'INVALID_RECIPE', validation });
    throw error;
  }

  const { recipe } = validation;
  const machine = recipe.machine;
  const firstId = Number.isInteger(context.firstVmid) ? context.firstVmid : 9000;
  const count = machine.count || 1;
  const steps = [];
  for (let index = 0; index < count; index += 1) {
    const vmid = firstId + index;
    if (machine.kind === 'lxc') {
      const argv = ['pct', 'create', String(vmid), String(machine.image), '--hostname', `${recipe.id}-${index + 1}`, '--cores', String(machine.cores || 1), '--memory', String(machine.memory || 512)];
      if (machine.disk !== undefined) argv.push('--rootfs', `${machine.storage || 'local-lvm'}:${machine.disk}`);
      if (machine.unprivileged !== undefined) argv.push('--unprivileged', machine.unprivileged ? '1' : '0');
      if (machine.features?.length) argv.push('--features', machine.features.map(String).join(','));
      steps.push(makeStep(`create-${vmid}`, `Create LXC ${vmid}`, argv));
    } else {
      steps.push(makeStep(`create-${vmid}`, `Create VM ${vmid}`, ['qm', 'create', String(vmid), '--name', `${recipe.id}-${index + 1}`, '--cores', String(machine.cores || 1), '--memory', String(machine.memory || 2048)]));
      steps.push(makeStep(`import-${vmid}`, `Import VM image for ${vmid}`, ['qm', 'importdisk', String(vmid), String(machine.image), String(machine.storage || 'local-lvm')]));
      steps.push(makeStep(`cloud-init-${vmid}`, `Configure cloud-init for ${vmid}`, ['qm', 'set', String(vmid), '--ciuser', '<configured-user>', '--ipconfig0', 'ip=dhcp']));
    }
    for (const [stepIndex, install] of (recipe.install || []).entries()) {
      if (install.type === 'command') steps.push(makeStep(`install-${vmid}-${stepIndex + 1}`, `Run recipe command on ${vmid}`, ['<guest-exec>', String(vmid), '--', String(install.run)], `Arbitrary command: ${String(install.run)}`));
      else steps.push({ id: `install-${vmid}-${stepIndex + 1}`, label: `Apply ${install.type} step to ${vmid}`, operation: structuredClone(install), risk: null, requiresConfirmation: true });
    }
    if (recipe.health) steps.push({ id: `health-${vmid}`, label: `Check health for ${vmid}`, operation: structuredClone(recipe.health), risk: null, requiresConfirmation: true });
    if (recipe.backup) steps.push({ id: `backup-${vmid}`, label: `Configure backup for ${vmid}`, operation: structuredClone(recipe.backup), risk: null, requiresConfirmation: true });
    if (recipe.network) steps.push({ id: `network-${vmid}`, label: `Configure network for ${vmid}`, operation: structuredClone(recipe.network), risk: null, requiresConfirmation: true });
    if (recipe.observability) steps.push({ id: `observability-${vmid}`, label: `Configure observability for ${vmid}`, operation: structuredClone(recipe.observability), risk: null, requiresConfirmation: true });
  }

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    generatedAt: new Date(context.now ? context.now() : Date.now()).toISOString(),
    requiresConfirmation: true,
    executable: false,
    steps,
    warnings: validation.warnings,
  };
}

module.exports = { generateRecipePlan };
