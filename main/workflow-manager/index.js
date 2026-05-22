const { spawn } = require('child_process');
const { getRepositories } = require('../database');
const { appendOutput } = require('../process-manager');
const { startProject, stopProject } = require('../process-manager');

const runningWorkflows = new Map();
let mainWindowGetter;

function windowRef() {
  return typeof mainWindowGetter === 'function' ? mainWindowGetter() : null;
}

function parseCommand(command) {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) || [];
  return { exec: parts[0], args: parts.slice(1) };
}

function listWorkflows(projectId) {
  const repositories = getRepositories();
  return repositories.workflows.findAll()
    .filter((workflow) => !projectId || workflow.project_id === Number(projectId))
    .map((workflow) => ({
      ...workflow,
      steps: listSteps(workflow.id)
    }));
}

function createWorkflow(payload) {
  return getRepositories().workflows.create({
    name: payload.name,
    type: payload.type || 'single',
    project_id: payload.project_id || null,
    description: payload.description || ''
  });
}

function updateWorkflow(workflowId, payload) {
  return getRepositories().workflows.update(Number(workflowId), {
    name: payload.name,
    type: payload.type || 'single',
    project_id: payload.project_id || null,
    description: payload.description || ''
  });
}

function deleteWorkflow(workflowId) {
  return getRepositories().workflows.delete(Number(workflowId));
}

function listSteps(workflowId) {
  return getRepositories().workflowSteps.findAll()
    .filter((step) => step.workflow_id === Number(workflowId))
    .sort((a, b) => a.step_order - b.step_order);
}

function createStep(workflowId, payload) {
  return getRepositories().workflowSteps.create({
    workflow_id: Number(workflowId),
    step_order: Number(payload.step_order),
    name: payload.name,
    command: payload.command,
    work_dir: payload.work_dir || '',
    timeout: payload.timeout ? Number(payload.timeout) : null,
    project_id: payload.project_id || null,
    action_type: payload.action_type || 'command',
    delay_seconds: payload.delay_seconds || 0
  });
}

function updateStep(stepId, payload) {
  return getRepositories().workflowSteps.update(Number(stepId), {
    step_order: Number(payload.step_order),
    name: payload.name,
    command: payload.command,
    work_dir: payload.work_dir || '',
    timeout: payload.timeout ? Number(payload.timeout) : null,
    project_id: payload.project_id || null,
    action_type: payload.action_type || 'command',
    delay_seconds: payload.delay_seconds || 0
  });
}

function deleteStep(stepId) {
  return getRepositories().workflowSteps.delete(Number(stepId));
}

function emitWorkflowStatus(workflowId) {
  const state = runningWorkflows.get(Number(workflowId));
  windowRef()?.webContents.send('workflow:status', state || { workflowId: Number(workflowId), running: false });
}

function writeStepOutput(projectId, data, type = 'stdout') {
  if (!projectId) return;
  const output = appendOutput(projectId, type, data);
  windowRef()?.webContents.send('terminal:output', output);
}

async function runStep(step, project) {
  if (step.action_type === 'start_project') {
    await startProject(step.project_id);
    return { ok: true, code: 0 };
  }
  return new Promise((resolve) => {
    if (!step.command) {
      resolve({ ok: true, code: 0 });
      return;
    }

    const { exec, args } = parseCommand(step.command);
    const child = spawn(exec, args, {
      cwd: step.work_dir || project?.path || process.cwd(),
      shell: false,
      windowsHide: false
    });

    let finished = false;
    let timer;
    if (step.timeout) {
      timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          child.kill();
          resolve({ ok: false, code: null, timeout: true });
        }
      }, Number(step.timeout) * 1000);
    }

    child.stdout?.on('data', (chunk) => writeStepOutput(step.project_id || project?.id, chunk.toString(), 'stdout'));
    child.stderr?.on('data', (chunk) => writeStepOutput(step.project_id || project?.id, chunk.toString(), 'stderr'));
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      writeStepOutput(step.project_id || project?.id, `${error.message}\n`, 'stderr');
      resolve({ ok: false, error });
    });
    child.on('exit', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code });
    });
  });
}

async function executeWorkflow(workflowId, options = {}) {
  const id = Number(workflowId);
  const repositories = getRepositories();
  const workflow = repositories.workflows.findById(id);
  if (!workflow) throw new Error('流程不存在');
  const project = workflow.project_id ? repositories.projects.findById(workflow.project_id) : null;
  const steps = listSteps(id);
  const state = {
    workflowId: id,
    running: true,
    currentStepId: null,
    steps: steps.map((step) => ({ id: step.id, name: step.name, status: 'waiting' }))
  };
  runningWorkflows.set(id, state);
  emitWorkflowStatus(id);

  for (const step of steps) {
    if (!runningWorkflows.has(id)) break;
    const stepState = state.steps.find((item) => item.id === step.id);
    state.currentStepId = step.id;
    stepState.status = 'running';
    emitWorkflowStatus(id);
    const result = await runStep(step, project);
    stepState.status = result.ok ? 'success' : 'failed';
    emitWorkflowStatus(id);
    if (!result.ok && options.onFailure !== 'skip') {
      state.running = false;
      runningWorkflows.delete(id);
      emitWorkflowStatus(id);
      return state;
    }
    if (!result.ok && options.onFailure === 'skip') {
      stepState.status = 'skipped';
      emitWorkflowStatus(id);
    }
  }

  state.running = false;
  state.currentStepId = null;
  runningWorkflows.delete(id);
  emitWorkflowStatus(id);
  return state;
}

async function stopWorkflow(workflowId) {
  const id = Number(workflowId);
  const repositories = getRepositories();
  const workflow = repositories.workflows.findById(id);
  if (!workflow) return false;
  
  const steps = listSteps(id);
  const startProjectSteps = steps.filter((step) => step.action_type === 'start_project');
  
  for (const step of startProjectSteps.reverse()) {
    try {
      await stopProject(step.project_id);
    } catch (err) {
      console.error(`停止项目 ${step.project_id} 失败:`, err);
    }
  }
  
  runningWorkflows.delete(id);
  emitWorkflowStatus(workflowId);
  return true;
}

function getWorkflowStatus(workflowId) {
  return runningWorkflows.get(Number(workflowId)) || { workflowId: Number(workflowId), running: false };
}

function registerWorkflowManagerIpc(ipcMain, getMainWindow) {
  mainWindowGetter = getMainWindow;
  ipcMain.handle('workflows:list', (_event, projectId) => listWorkflows(projectId));
  ipcMain.handle('workflows:create', (_event, payload) => createWorkflow(payload));
  ipcMain.handle('workflows:update', (_event, workflowId, payload) => updateWorkflow(workflowId, payload));
  ipcMain.handle('workflows:delete', (_event, workflowId) => deleteWorkflow(workflowId));
  ipcMain.handle('workflow-steps:create', (_event, workflowId, payload) => createStep(workflowId, payload));
  ipcMain.handle('workflow-steps:update', (_event, stepId, payload) => updateStep(stepId, payload));
  ipcMain.handle('workflow-steps:delete', (_event, stepId) => deleteStep(stepId));
  ipcMain.handle('workflows:execute', (_event, workflowId, options) => executeWorkflow(workflowId, options));
  ipcMain.handle('workflows:stop', (_event, workflowId) => stopWorkflow(workflowId));
  ipcMain.handle('workflows:status', (_event, workflowId) => getWorkflowStatus(workflowId));
}

module.exports = {
  parseCommand,
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  listSteps,
  createStep,
  updateStep,
  deleteStep,
  executeWorkflow,
  stopWorkflow,
  getWorkflowStatus,
  registerWorkflowManagerIpc
};
