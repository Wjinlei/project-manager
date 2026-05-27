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
    delay_seconds: payload.delay_seconds || 0,
    script_path: payload.script_path || '',
    http_config: payload.http_config || '',
    file_config: payload.file_config || '',
    interpreter: payload.interpreter || '',
    enabled: payload.enabled !== false
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
    delay_seconds: payload.delay_seconds || 0,
    script_path: payload.script_path || '',
    http_config: payload.http_config || '',
    file_config: payload.file_config || '',
    interpreter: payload.interpreter || '',
    enabled: payload.enabled !== false
  });
}

function deleteStep(stepId) {
  return getRepositories().workflowSteps.delete(Number(stepId));
}

function reorderStep(stepId, direction) {
  const repositories = getRepositories();
  const step = repositories.workflowSteps.findById(Number(stepId));
  if (!step) throw new Error('步骤不存在');
  
  const workflowId = step.workflow_id;
  const steps = listSteps(workflowId);
  const currentIndex = steps.findIndex((s) => s.id === Number(stepId));
  
  if (direction === 'up' && currentIndex <= 0) {
    throw new Error('已经是第一个步骤');
  }
  if (direction === 'down' && currentIndex >= steps.length - 1) {
    throw new Error('已经是最后一个步骤');
  }
  
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  const targetStep = steps[targetIndex];
  
  // 交换序号
  const currentOrder = step.step_order;
  const targetOrder = targetStep.step_order;
  
  repositories.workflowSteps.update(Number(stepId), { step_order: targetOrder });
  repositories.workflowSteps.update(targetStep.id, { step_order: currentOrder });
  
  return listSteps(workflowId);
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
  // 检查步骤是否启用
  if (step.enabled === false) {
    return { ok: true, skipped: true };
  }

  // 启动项目任务
  if (step.action_type === 'start_project') {
    try {
      writeStepOutput(step.project_id, `启动项目 ID: ${step.project_id}\n`, 'stdout');
      await startProject(step.project_id);
      writeStepOutput(step.project_id, `项目启动成功\n`, 'stdout');
      return { ok: true, code: 0 };
    } catch (error) {
      writeStepOutput(step.project_id, `项目启动失败: ${error.message}\n`, 'stderr');
      return { ok: false, error };
    }
  }

  // 停止项目任务
  if (step.action_type === 'stop_project') {
    try {
      writeStepOutput(step.project_id, `停止项目 ID: ${step.project_id}\n`, 'stdout');
      await stopProject(step.project_id);
      writeStepOutput(step.project_id, `项目停止成功\n`, 'stdout');
      return { ok: true, code: 0 };
    } catch (error) {
      writeStepOutput(step.project_id, `项目停止失败: ${error.message}\n`, 'stderr');
      return { ok: false, error };
    }
  }

  // 执行脚本任务
  if (step.action_type === 'script') {
    return new Promise((resolve) => {
      if (!step.script_path) {
        writeStepOutput(step.project_id || project?.id, `错误: 未指定脚本路径\n`, 'stderr');
        resolve({ ok: false, error: new Error('未指定脚本路径') });
        return;
      }

      const fs = require('fs');
      const path = require('path');
      
      // 检查脚本文件是否存在
      const scriptFullPath = path.resolve(step.work_dir || project?.path || process.cwd(), step.script_path);
      if (!fs.existsSync(scriptFullPath)) {
        writeStepOutput(step.project_id || project?.id, `错误: 脚本文件不存在: ${scriptFullPath}\n`, 'stderr');
        resolve({ ok: false, error: new Error('脚本文件不存在') });
        return;
      }

      // 确定解释器
      let interpreter = step.interpreter;
      if (!interpreter) {
        const ext = path.extname(step.script_path).toLowerCase();
        const interpreterMap = {
          '.sh': 'bash',
          '.bat': 'cmd',
          '.cmd': 'cmd',
          '.js': 'node',
          '.py': 'python',
          '.ps1': 'powershell'
        };
        interpreter = interpreterMap[ext] || 'bash';
      }

      writeStepOutput(step.project_id || project?.id, `执行脚本: ${step.script_path} (解释器: ${interpreter})\n`, 'stdout');

      const child = spawn(interpreter, [scriptFullPath], {
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
            writeStepOutput(step.project_id || project?.id, `脚本执行超时 (${step.timeout}秒)\n`, 'stderr');
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
        writeStepOutput(step.project_id || project?.id, `脚本执行错误: ${error.message}\n`, 'stderr');
        resolve({ ok: false, error });
      });
      child.on('exit', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (code === 0) {
          writeStepOutput(step.project_id || project?.id, `脚本执行成功\n`, 'stdout');
        } else {
          writeStepOutput(step.project_id || project?.id, `脚本执行失败，退出码: ${code}\n`, 'stderr');
        }
        resolve({ ok: code === 0, code });
      });
    });
  }

  // 等待延迟任务
  if (step.action_type === 'delay') {
    return new Promise((resolve) => {
      const delaySeconds = step.delay_seconds || 0;
      writeStepOutput(step.project_id || project?.id, `等待 ${delaySeconds} 秒...\n`, 'stdout');
      
      setTimeout(() => {
        writeStepOutput(step.project_id || project?.id, `等待完成\n`, 'stdout');
        resolve({ ok: true, code: 0 });
      }, delaySeconds * 1000);
    });
  }

  // HTTP 请求任务
  if (step.action_type === 'http_request') {
    return new Promise(async (resolve) => {
      try {
        const httpConfig = step.http_config ? JSON.parse(step.http_config) : {};
        const { url, method = 'GET', headers = {}, body } = httpConfig;
        
        if (!url) {
          writeStepOutput(step.project_id || project?.id, `错误: 未指定 URL\n`, 'stderr');
          resolve({ ok: false, error: new Error('未指定 URL') });
          return;
        }

        writeStepOutput(step.project_id || project?.id, `发送 ${method} 请求到: ${url}\n`, 'stdout');
        if (Object.keys(headers).length > 0) {
          writeStepOutput(step.project_id || project?.id, `Headers: ${JSON.stringify(headers)}\n`, 'stdout');
        }
        if (body) {
          writeStepOutput(step.project_id || project?.id, `Body: ${body}\n`, 'stdout');
        }

        const fetchOptions = {
          method,
          headers,
          signal: AbortSignal.timeout(step.timeout ? step.timeout * 1000 : 30000)
        };

        if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);
        const responseText = await response.text();
        
        writeStepOutput(step.project_id || project?.id, `响应状态: ${response.status} ${response.statusText}\n`, 'stdout');
        writeStepOutput(step.project_id || project?.id, `响应内容: ${responseText}\n`, 'stdout');

        if (response.ok) {
          resolve({ ok: true, code: response.status });
        } else {
          writeStepOutput(step.project_id || project?.id, `HTTP 请求失败，状态码: ${response.status}\n`, 'stderr');
          resolve({ ok: false, code: response.status });
        }
      } catch (error) {
        writeStepOutput(step.project_id || project?.id, `HTTP 请求错误: ${error.message}\n`, 'stderr');
        resolve({ ok: false, error });
      }
    });
  }

  // 文件操作任务
  if (step.action_type === 'file_operation') {
    return new Promise(async (resolve) => {
      try {
        const fs = require('fs');
        const path = require('path');
        const fileConfig = step.file_config ? JSON.parse(step.file_config) : {};
        const { operation, source, target, recursive = false } = fileConfig;
        
        if (!operation) {
          writeStepOutput(step.project_id || project?.id, `错误: 未指定操作类型\n`, 'stderr');
          resolve({ ok: false, error: new Error('未指定操作类型') });
          return;
        }

        const workDir = step.work_dir || project?.path || process.cwd();
        const sourcePath = source ? path.resolve(workDir, source) : null;
        const targetPath = target ? path.resolve(workDir, target) : null;

        if (operation === 'copy') {
          if (!sourcePath || !targetPath) {
            writeStepOutput(step.project_id || project?.id, `错误: 复制操作需要源路径和目标路径\n`, 'stderr');
            resolve({ ok: false, error: new Error('缺少路径参数') });
            return;
          }
          if (!fs.existsSync(sourcePath)) {
            writeStepOutput(step.project_id || project?.id, `错误: 源文件不存在: ${sourcePath}\n`, 'stderr');
            resolve({ ok: false, error: new Error('源文件不存在') });
            return;
          }
          
          writeStepOutput(step.project_id || project?.id, `复制 ${sourcePath} 到 ${targetPath}\n`, 'stdout');
          
          if (recursive) {
            fs.cpSync(sourcePath, targetPath, { recursive: true });
          } else {
            fs.copyFileSync(sourcePath, targetPath);
          }
          
          writeStepOutput(step.project_id || project?.id, `复制成功\n`, 'stdout');
          resolve({ ok: true, code: 0 });
        } else if (operation === 'move') {
          if (!sourcePath || !targetPath) {
            writeStepOutput(step.project_id || project?.id, `错误: 移动操作需要源路径和目标路径\n`, 'stderr');
            resolve({ ok: false, error: new Error('缺少路径参数') });
            return;
          }
          if (!fs.existsSync(sourcePath)) {
            writeStepOutput(step.project_id || project?.id, `错误: 源文件不存在: ${sourcePath}\n`, 'stderr');
            resolve({ ok: false, error: new Error('源文件不存在') });
            return;
          }
          
          writeStepOutput(step.project_id || project?.id, `移动 ${sourcePath} 到 ${targetPath}\n`, 'stdout');
          fs.renameSync(sourcePath, targetPath);
          writeStepOutput(step.project_id || project?.id, `移动成功\n`, 'stdout');
          resolve({ ok: true, code: 0 });
        } else if (operation === 'delete') {
          if (!sourcePath) {
            writeStepOutput(step.project_id || project?.id, `错误: 删除操作需要源路径\n`, 'stderr');
            resolve({ ok: false, error: new Error('缺少路径参数') });
            return;
          }
          if (!fs.existsSync(sourcePath)) {
            writeStepOutput(step.project_id || project?.id, `错误: 文件不存在: ${sourcePath}\n`, 'stderr');
            resolve({ ok: false, error: new Error('文件不存在') });
            return;
          }
          
          writeStepOutput(step.project_id || project?.id, `删除 ${sourcePath}\n`, 'stdout');
          
          if (recursive) {
            fs.rmSync(sourcePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(sourcePath);
          }
          
          writeStepOutput(step.project_id || project?.id, `删除成功\n`, 'stdout');
          resolve({ ok: true, code: 0 });
        } else {
          writeStepOutput(step.project_id || project?.id, `错误: 不支持的操作类型: ${operation}\n`, 'stderr');
          resolve({ ok: false, error: new Error('不支持的操作类型') });
        }
      } catch (error) {
        writeStepOutput(step.project_id || project?.id, `文件操作错误: ${error.message}\n`, 'stderr');
        resolve({ ok: false, error });
      }
    });
  }

  // 消息通知任务（占位实现）
  if (step.action_type === 'notification') {
    return new Promise((resolve) => {
      const httpConfig = step.http_config ? JSON.parse(step.http_config) : {};
      const { message = '通知消息', channel = 'log' } = httpConfig;
      
      writeStepOutput(step.project_id || project?.id, `[通知] ${message} (渠道: ${channel})\n`, 'stdout');
      
      // 占位实现：仅输出日志
      // 预留扩展接口：后续可支持系统通知、邮件、钉钉、企业微信等
      switch (channel) {
        case 'log':
          // 当前仅输出到日志
          break;
        case 'system':
          // TODO: 实现系统通知
          writeStepOutput(step.project_id || project?.id, `系统通知功能待实现\n`, 'stdout');
          break;
        case 'email':
          // TODO: 实现邮件通知
          writeStepOutput(step.project_id || project?.id, `邮件通知功能待实现\n`, 'stdout');
          break;
        case 'dingtalk':
          // TODO: 实现钉钉通知
          writeStepOutput(step.project_id || project?.id, `钉钉通知功能待实现\n`, 'stdout');
          break;
        default:
          writeStepOutput(step.project_id || project?.id, `未知通知渠道: ${channel}\n`, 'stderr');
      }
      
      resolve({ ok: true, code: 0 });
    });
  }

  // 执行命令任务（原有逻辑）
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
          writeStepOutput(step.project_id || project?.id, `执行超时 (${step.timeout}秒)\n`, 'stderr');
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
  ipcMain.handle('workflow-steps:reorder', (_event, stepId, direction) => reorderStep(stepId, direction));
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
  reorderStep,
  executeWorkflow,
  stopWorkflow,
  getWorkflowStatus,
  registerWorkflowManagerIpc
};
