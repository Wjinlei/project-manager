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
  const existingSteps = listSteps(workflowId);
  const maxOrder = existingSteps.length > 0 ? Math.max(...existingSteps.map(s => s.step_order)) : 0;
  return getRepositories().workflowSteps.create({
    workflow_id: Number(workflowId),
    step_order: maxOrder + 1,
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
    enabled: payload.enabled ? 1 : 0
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
    enabled: payload.enabled ? 1 : 0
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

function writeStepOutput(projectId, data, type = 'stdout', workflowId = null) {
  const outputId = workflowId || projectId;
  const output = appendOutput(outputId, type, data);
  windowRef()?.webContents.send('terminal:output', output);
}

async function runStep(step, project, workflowId) {
  // 检查步骤是否启用（数据库中是整数 1/0）
  if (step.enabled === 0 || step.enabled === false) {
    return { ok: true, skipped: true };
  }

  // 启动项目任务
  if (step.action_type === 'start_project') {
    try {
      writeStepOutput(step.project_id, `启动项目 ID: ${step.project_id}\n`, 'stdout', workflowId);
      await startProject(step.project_id);
      writeStepOutput(step.project_id, `项目启动成功\n`, 'stdout', workflowId);
      return { ok: true, code: 0 };
    } catch (error) {
      writeStepOutput(step.project_id, `项目启动失败: ${error.message}\n`, 'stderr', workflowId);
      return { ok: false, error };
    }
  }

  // 停止项目任务
  if (step.action_type === 'stop_project') {
    try {
      writeStepOutput(step.project_id, `停止项目 ID: ${step.project_id}\n`, 'stdout', workflowId);
      await stopProject(step.project_id);
      writeStepOutput(step.project_id, `项目停止成功\n`, 'stdout', workflowId);
      return { ok: true, code: 0 };
    } catch (error) {
      writeStepOutput(step.project_id, `项目停止失败: ${error.message}\n`, 'stderr', workflowId);
      return { ok: false, error };
    }
  }

  // 执行脚本任务
  if (step.action_type === 'script') {
    return new Promise((resolve) => {
      if (!step.script_path) {
        writeStepOutput(step.project_id || project?.id, `错误: 未指定脚本路径\n`, 'stderr', workflowId);
        resolve({ ok: false, error: new Error('未指定脚本路径') });
        return;
      }

      const fs = require('fs');
      const path = require('path');
      
      // 检查脚本文件是否存在
      const scriptFullPath = path.resolve(step.work_dir || project?.path || process.cwd(), step.script_path);
      if (!fs.existsSync(scriptFullPath)) {
        writeStepOutput(step.project_id || project?.id, `错误: 脚本文件不存在: ${scriptFullPath}\n`, 'stderr', workflowId);
        resolve({ ok: false, error: new Error('脚本文件不存在') });
        return;
      }

      // 确定解释器
      let interpreter = step.interpreter;
      let scriptArgs = [scriptFullPath];
      
      if (!interpreter) {
        const ext = path.extname(step.script_path).toLowerCase();
        const interpreterMap = {
          '.sh': { cmd: 'bash', args: [scriptFullPath] },
          '.bat': { cmd: 'cmd', args: ['/c', scriptFullPath] },
          '.cmd': { cmd: 'cmd', args: ['/c', scriptFullPath] },
          '.js': { cmd: 'node', args: [scriptFullPath] },
          '.py': { cmd: 'python', args: [scriptFullPath] },
          '.ps1': { cmd: 'powershell', args: ['-File', scriptFullPath] }
        };
        const mapped = interpreterMap[ext] || { cmd: 'bash', args: [scriptFullPath] };
        interpreter = mapped.cmd;
        scriptArgs = mapped.args;
      }

      writeStepOutput(step.project_id || project?.id, `执行脚本: ${step.script_path} (解释器: ${interpreter})\n`, 'stdout', workflowId);

      const child = spawn(interpreter, scriptArgs, {
        cwd: step.work_dir || project?.path || process.cwd(),
        shell: false,
        windowsHide: false
      });

      let finished = false;
      let timer;
      const timeout = step.timeout || 60; // 默认60秒超时
      timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          child.kill();
          writeStepOutput(step.project_id || project?.id, `脚本执行超时 (${timeout}秒)\n`, 'stderr', workflowId);
          resolve({ ok: false, code: null, timeout: true });
        }
      }, Number(timeout) * 1000);

      child.stdout?.on('data', (chunk) => writeStepOutput(step.project_id || project?.id, chunk.toString(), 'stdout', workflowId));
      child.stderr?.on('data', (chunk) => writeStepOutput(step.project_id || project?.id, chunk.toString(), 'stderr', workflowId));
      child.on('error', (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        writeStepOutput(step.project_id || project?.id, `脚本执行错误: ${error.message}\n`, 'stderr', workflowId);
        resolve({ ok: false, error });
      });
      child.on('exit', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (code === 0) {
          writeStepOutput(step.project_id || project?.id, `脚本执行成功\n`, 'stdout', workflowId);
        } else {
          writeStepOutput(step.project_id || project?.id, `脚本执行失败，退出码: ${code}\n`, 'stderr', workflowId);
        }
        resolve({ ok: code === 0, code });
      });
    });
  }

  // 等待延迟任务
  if (step.action_type === 'delay') {
    return new Promise((resolve) => {
      const delaySeconds = step.delay_seconds || 0;
      writeStepOutput(step.project_id || project?.id, `等待 ${delaySeconds} 秒...\n`, 'stdout', workflowId);
      
      setTimeout(() => {
        writeStepOutput(step.project_id || project?.id, `等待完成\n`, 'stdout', workflowId);
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
          writeStepOutput(step.project_id || project?.id, `错误: 未指定 URL\n`, 'stderr', workflowId);
          resolve({ ok: false, error: new Error('未指定 URL') });
          return;
        }

        writeStepOutput(step.project_id || project?.id, `发送 ${method} 请求到: ${url}\n`, 'stdout', workflowId);
        if (Object.keys(headers).length > 0) {
          writeStepOutput(step.project_id || project?.id, `Headers: ${JSON.stringify(headers)}\n`, 'stdout', workflowId);
        }
        if (body) {
          writeStepOutput(step.project_id || project?.id, `Body: ${body}\n`, 'stdout', workflowId);
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
        
        writeStepOutput(step.project_id || project?.id, `响应状态: ${response.status} ${response.statusText}\n`, 'stdout', workflowId);
        writeStepOutput(step.project_id || project?.id, `响应内容: ${responseText}\n`, 'stdout', workflowId);

        if (response.ok) {
          resolve({ ok: true, code: response.status });
        } else {
          writeStepOutput(step.project_id || project?.id, `HTTP 请求失败，状态码: ${response.status}\n`, 'stderr', workflowId);
          resolve({ ok: false, code: response.status });
        }
      } catch (error) {
        writeStepOutput(step.project_id || project?.id, `HTTP 请求错误: ${error.message}\n`, 'stderr', workflowId);
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
        const { operation, source, target } = fileConfig;
        
        if (!operation) {
          writeStepOutput(step.project_id || project?.id, `错误: 未指定操作类型\n`, 'stderr', workflowId);
          resolve({ ok: false, error: new Error('未指定操作类型') });
          return;
        }

        const workDir = step.work_dir || project?.path || process.cwd();
        const sourcePath = source ? path.resolve(workDir, source) : null;
        const targetPath = target ? path.resolve(workDir, target) : null;

        if (operation === 'copy') {
          if (!sourcePath || !targetPath) {
            writeStepOutput(step.project_id || project?.id, `错误: 复制操作需要源路径和目标路径\n`, 'stderr', workflowId);
            resolve({ ok: false, error: new Error('缺少路径参数') });
            return;
          }
          if (!fs.existsSync(sourcePath)) {
            writeStepOutput(step.project_id || project?.id, `错误: 源文件不存在: ${sourcePath}\n`, 'stderr', workflowId);
            resolve({ ok: false, error: new Error('源文件不存在') });
            return;
          }
          
          writeStepOutput(step.project_id || project?.id, `复制 ${sourcePath} 到 ${targetPath}\n`, 'stdout', workflowId);
          
          const srcStat = fs.statSync(sourcePath);
          if (srcStat.isDirectory()) {
            // 复制整个目录：目标为 targetPath/源目录名
            const destDir = path.join(targetPath, path.basename(sourcePath));
            fs.cpSync(sourcePath, destDir, { recursive: true });
          } else {
            fs.copyFileSync(sourcePath, targetPath);
          }
          
          writeStepOutput(step.project_id || project?.id, `复制成功\n`, 'stdout', workflowId);
          resolve({ ok: true, code: 0 });
        } else if (operation === 'move') {
          if (!sourcePath || !targetPath) {
            writeStepOutput(step.project_id || project?.id, `错误: 移动操作需要源路径和目标路径\n`, 'stderr', workflowId);
            resolve({ ok: false, error: new Error('缺少路径参数') });
            return;
          }
          if (!fs.existsSync(sourcePath)) {
            writeStepOutput(step.project_id || project?.id, `错误: 源路径不存在: ${sourcePath}\n`, 'stderr', workflowId);
            resolve({ ok: false, error: new Error('源路径不存在') });
            return;
          }
          
          writeStepOutput(step.project_id || project?.id, `移动 ${sourcePath} 到 ${targetPath}\n`, 'stdout', workflowId);
          const srcStat = fs.statSync(sourcePath);
          const finalTarget = srcStat.isDirectory() ? path.join(targetPath, path.basename(sourcePath)) : targetPath;
          try {
            fs.renameSync(sourcePath, finalTarget);
          } catch (renameErr) {
            // renameSync 跨盘符失败时用复制+删除
            if (srcStat.isDirectory()) {
              fs.cpSync(sourcePath, finalTarget, { recursive: true });
            } else {
              fs.copyFileSync(sourcePath, finalTarget);
            }
            fs.rmSync(sourcePath, { recursive: true, force: true });
          }
          writeStepOutput(step.project_id || project?.id, `移动成功\n`, 'stdout', workflowId);
          resolve({ ok: true, code: 0 });
        } else if (operation === 'delete') {
          if (!sourcePath) {
            writeStepOutput(step.project_id || project?.id, `错误: 删除操作需要源路径\n`, 'stderr', workflowId);
            resolve({ ok: false, error: new Error('缺少路径参数') });
            return;
          }
          if (!fs.existsSync(sourcePath)) {
            writeStepOutput(step.project_id || project?.id, `错误: 文件不存在: ${sourcePath}\n`, 'stderr', workflowId);
            resolve({ ok: false, error: new Error('文件不存在') });
            return;
          }
          
          writeStepOutput(step.project_id || project?.id, `删除 ${sourcePath}\n`, 'stdout', workflowId);
          
          const stat = fs.statSync(sourcePath);
          if (stat.isDirectory()) {
            fs.rmSync(sourcePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(sourcePath);
          }
          
          writeStepOutput(step.project_id || project?.id, `删除成功\n`, 'stdout', workflowId);
          resolve({ ok: true, code: 0 });
        } else {
          writeStepOutput(step.project_id || project?.id, `错误: 不支持的操作类型: ${operation}\n`, 'stderr', workflowId);
          resolve({ ok: false, error: new Error('不支持的操作类型') });
        }
      } catch (error) {
        writeStepOutput(step.project_id || project?.id, `文件操作错误: ${error.message}\n`, 'stderr', workflowId);
        resolve({ ok: false, error });
      }
    });
  }

  // 消息通知任务（占位实现）
  if (step.action_type === 'notification') {
    return new Promise((resolve) => {
      const httpConfig = step.http_config ? JSON.parse(step.http_config) : {};
      const { message = '通知消息', channel = 'log' } = httpConfig;
      
      writeStepOutput(step.project_id || project?.id, `[通知] ${message} (渠道: ${channel})\n`, 'stdout', workflowId);
      
      // 占位实现：仅输出日志
      // 预留扩展接口：后续可支持系统通知、邮件、钉钉、企业微信等
      switch (channel) {
        case 'log':
          // 当前仅输出到日志
          break;
        case 'system':
          // TODO: 实现系统通知
          writeStepOutput(step.project_id || project?.id, `系统通知功能待实现\n`, 'stdout', workflowId);
          break;
        case 'email':
          // TODO: 实现邮件通知
          writeStepOutput(step.project_id || project?.id, `邮件通知功能待实现\n`, 'stdout', workflowId);
          break;
        case 'dingtalk':
          // TODO: 实现钉钉通知
          writeStepOutput(step.project_id || project?.id, `钉钉通知功能待实现\n`, 'stdout', workflowId);
          break;
        default:
          writeStepOutput(step.project_id || project?.id, `未知通知渠道: ${channel}\n`, 'stderr', workflowId);
      }
      
      resolve({ ok: true, code: 0 });
    });
  }

  // 执行命令任务
  if (step.action_type === 'command') {
    return new Promise((resolve) => {
      if (!step.command) {
        writeStepOutput(step.project_id || project?.id, `错误: 未指定命令\n`, 'stderr', workflowId);
        resolve({ ok: false, error: new Error('未指定命令') });
        return;
      }

      writeStepOutput(step.project_id || project?.id, `执行命令: ${step.command}\n`, 'stdout', workflowId);

      const child = spawn(step.command, [], {
        cwd: step.work_dir || project?.path || process.cwd(),
        shell: true,
        windowsHide: false
      });

      let finished = false;
      let timer;
      const timeout = step.timeout || 60;
      timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          child.kill();
          writeStepOutput(step.project_id || project?.id, `命令执行超时 (${timeout}秒)\n`, 'stderr', workflowId);
          resolve({ ok: false, code: null, timeout: true });
        }
      }, Number(timeout) * 1000);

      child.stdout?.on('data', (chunk) => writeStepOutput(step.project_id || project?.id, chunk.toString(), 'stdout', workflowId));
      child.stderr?.on('data', (chunk) => writeStepOutput(step.project_id || project?.id, chunk.toString(), 'stderr', workflowId));
      child.on('error', (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        writeStepOutput(step.project_id || project?.id, `命令执行错误: ${error.message}\n`, 'stderr', workflowId);
        resolve({ ok: false, error });
      });
      child.on('exit', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (code === 0) {
          writeStepOutput(step.project_id || project?.id, `命令执行成功\n`, 'stdout', workflowId);
        } else {
          writeStepOutput(step.project_id || project?.id, `命令执行失败，退出码: ${code}\n`, 'stderr', workflowId);
        }
        resolve({ ok: code === 0, code });
      });
    });
  }

  // 未知任务类型
  writeStepOutput(step.project_id || project?.id, `未知任务类型: ${step.action_type}\n`, 'stderr', workflowId);
  return { ok: false, error: new Error(`未知任务类型: ${step.action_type}`) };
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
    
    // 禁用的步骤直接标记为 skipped
    if (step.enabled === 0 || step.enabled === false) {
      stepState.status = 'skipped';
      emitWorkflowStatus(id);
      continue;
    }
    
    stepState.status = 'running';
    emitWorkflowStatus(id);
    const result = await runStep(step, project, id);
    
    if (result.skipped) {
      stepState.status = 'skipped';
    } else {
      stepState.status = result.ok ? 'success' : 'failed';
    }
    emitWorkflowStatus(id);
    
    if (!result.ok && !result.skipped && options.onFailure !== 'skip') {
      state.running = false;
      state.currentStepId = null;
      emitWorkflowStatus(id);
      return state;
    }
  }

  state.running = false;
  state.currentStepId = null;
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
  
  const state = runningWorkflows.get(id);
  if (state) {
    state.running = false;
    state.currentStepId = null;
  }
  emitWorkflowStatus(id);
  return true;
}

function getWorkflowStatus(workflowId) {
  return runningWorkflows.get(Number(workflowId)) || { workflowId: Number(workflowId), running: false };
}

async function executeStep(stepId) {
  const repositories = getRepositories();
  const step = repositories.workflowSteps.findById(Number(stepId));
  if (!step) throw new Error('步骤不存在');
  const workflow = repositories.workflows.findById(step.workflow_id);
  const project = workflow?.project_id ? repositories.projects.findById(workflow.project_id) : null;
  const wid = step.workflow_id;

  const state = runningWorkflows.get(wid) || {
    workflowId: wid,
    running: true,
    currentStepId: step.id,
    steps: [{ id: step.id, name: step.name, status: 'running' }]
  };
  // 如果已有 state，更新对应步骤
  const existing = state.steps.find((s) => s.id === step.id);
  if (existing) {
    existing.status = 'running';
  } else {
    state.steps.push({ id: step.id, name: step.name, status: 'running' });
  }
  state.running = true;
  state.currentStepId = step.id;
  runningWorkflows.set(wid, state);
  emitWorkflowStatus(wid);

  const result = await runStep(step, project, wid);

  const stepState = state.steps.find((s) => s.id === step.id);
  if (stepState) {
    stepState.status = result.skipped ? 'skipped' : result.ok ? 'success' : 'failed';
  }
  state.running = false;
  state.currentStepId = null;
  emitWorkflowStatus(wid);
  return result;
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
  ipcMain.handle('workflows:execute-step', (_event, stepId) => executeStep(stepId));
  ipcMain.handle('workflows:stop', (_event, workflowId) => stopWorkflow(workflowId));
  ipcMain.handle('workflows:status', (_event, workflowId) => getWorkflowStatus(workflowId));
  
  // 文件和目录选择
  ipcMain.handle('workflow:select-file', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(windowRef(), {
      title: '选择文件',
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  
  ipcMain.handle('workflow:select-directory', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(windowRef(), {
      title: '选择目录',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('workflow:select-path', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(windowRef(), {
      title: '选择文件或目录',
      properties: ['openFile', 'openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
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
