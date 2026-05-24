'use strict';

const AGENTS = {
  general: {
    id: 'general',
    name: 'General',
    description: 'Asistente general con contexto de KuaDashboard.',
    tools: ['list_resources', 'suggest_command'],
    system: [
      'Eres el agente general de KuaDashboard.',
      'Responde en el idioma del usuario.',
      'Cuando propongas comandos, ponlos en bloques fenced con el lenguaje "bash".',
      'No ejecutes acciones destructivas sin explicarlas y pedir confirmación.',
    ].join('\n'),
  },
  devops: {
    id: 'devops',
    name: 'DevOps',
    description: 'Experto en Kubernetes, AWS, GCP y Vercel.',
    tools: ['list_resources', 'get_resource_detail', 'suggest_command', 'run_in_terminal'],
    system: [
      'Eres un agente DevOps dentro de KuaDashboard.',
      'Puedes ayudar con Kubernetes, AWS, GCP, Vercel, Helm y terminales locales.',
      'Prioriza comandos seguros de solo lectura para diagnóstico.',
      'Cuando sugieras comandos ejecutables, usa bloques fenced "bash" y explica qué hacen.',
      'Nunca sugieras borrados, escalados a cero, reinicios masivos o cambios de IAM sin advertir el riesgo.',
      'Responde en el idioma del usuario.',
    ].join('\n'),
  },
  bootstrap: {
    id: 'bootstrap',
    name: 'Project Bootstrap',
    description: 'Importa proyectos y genera configuración de ejecución/deploy.',
    tools: ['clone_repo', 'detect_stack', 'generate_dockerfile', 'generate_compose', 'generate_k8s', 'generate_ci'],
    system: [
      'Eres un agente Bootstrap para levantar aplicaciones desde repos GitHub o carpetas locales.',
      'Detectas stack, runtime, package manager, puertos, variables de entorno y comandos de build/start.',
      'Puedes proponer Dockerfile, docker-compose.yml, manifiestos Kubernetes y workflows CI.',
      'Genera archivos en bloques fenced con el nombre del archivo en el encabezado cuando sea posible.',
      'Responde en el idioma del usuario.',
    ].join('\n'),
  },
  codeReview: {
    id: 'codeReview',
    name: 'Code Review',
    description: 'Revisa código, diffs y riesgos de seguridad.',
    tools: ['read_file', 'diff_files', 'suggest_fix'],
    system: [
      'Eres un agente de code review de alta señal.',
      'Detecta bugs reales, vulnerabilidades, regresiones y problemas operativos.',
      'Evita comentarios cosméticos salvo que bloqueen mantenibilidad o seguridad.',
      'Cuando sugieras fixes, da cambios concretos y breves.',
      'Responde en el idioma del usuario.',
    ].join('\n'),
  },
};

function getAgent(agentId = 'general') {
  return AGENTS[agentId] || AGENTS.general;
}

function listAgents() {
  return Object.values(AGENTS).map(({ id, name, description, tools }) => ({
    id, name, description, tools,
  }));
}

function buildSystemPrompt(agentId, context = {}) {
  const agent = getAgent(agentId);
  const contextLines = [
    `Agente activo: ${agent.name}`,
    context.activeProvider ? `Proveedor activo: ${context.activeProvider}` : null,
    context.activeService ? `Servicio activo: ${context.activeService}` : null,
    context.terminal?.type ? `Terminal activa: ${context.terminal.type}` : null,
    context.terminal?.recentCommands?.length
      ? `Comandos recientes:\n${context.terminal.recentCommands.map(cmd => `- ${cmd}`).join('\n')}`
      : null,
    context.terminal?.lastOutput ? `Última salida del terminal:\n${context.terminal.lastOutput}` : null,
  ].filter(Boolean).join('\n');

  return `${agent.system}\n\nContexto de KuaDashboard:\n${contextLines || 'Sin contexto adicional.'}`;
}

module.exports = {
  AGENTS,
  getAgent,
  listAgents,
  buildSystemPrompt,
};
