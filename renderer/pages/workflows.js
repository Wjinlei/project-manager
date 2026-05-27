let workflowState = { projects: [], runtimeStatuses: [], workflows: [], selectedWorkflowId: null, unsubscribe: null, statuses: {}, operating: false, operatingAction: null, loading: false, editingStepId: null };

function wfEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function workflowProjectName(projectId) {
  return workflowState.projects.find((project) => Number(project.id) === Number(projectId))?.name || '-';
}

function workflowRuntimeOf(projectId) {
  return workflowState.runtimeStatuses.find((status) => Number(status.projectId) === Number(projectId));
}

function workflowProjectStatus(projectId) {
  const runtime = workflowRuntimeOf(projectId);
  const isRunning = Boolean(runtime?.running);
  return isRunning ? 'running' : 'stopped';
}

function renderWorkflowPage() {
  return `
    <div class="row g-3">
      <div class="col-md-3">
        <div class="d-flex justify-content-between align-items-center mb-2"><h6 class="mb-0">流程列表</h6><button class="btn btn-sm btn-bt" id="addWorkflowBtn">新增流程</button></div>
        <div class="list-group" id="workflowList"></div>
      </div>
      <div class="col-md-9">
        <div class="workflow-editor" id="workflowEditor"><div class="placeholder-panel"><h5>请选择流程</h5><p>选择左侧流程后编辑步骤并执行。</p></div></div>
      </div>
    </div>
    <div class="modal fade" id="workflowModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">新建流程</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <label class="form-label">流程名称</label>
            <input class="form-control form-control-sm" id="newWorkflowNameInput" placeholder="请输入流程名称">
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="saveNewWorkflowBtn">保存</button></div>
        </div>
      </div>
    </div>
    <div class="modal fade" id="stepTypeModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">选择步骤类型</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <label class="form-label">任务类型</label>
            <select class="form-select form-select-sm" id="stepTypeSelect">
              <option value="">请选择任务类型</option>
              <option value="start_project">启动项目</option>
              <option value="stop_project">停止项目</option>
              <option value="command">执行命令</option>
              <option value="script">执行脚本</option>
              <option value="delay">等待延迟</option>
              <option value="http_request">HTTP 请求</option>
              <option value="file_operation">文件操作</option>
              <option value="notification">消息通知</option>
            </select>
            <div id="stepConfigForm" class="mt-3"></div>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="saveStepBtn">保存</button></div>
        </div>
      </div>
    </div>
  `;
}

function renderWorkflowList() {
  if (workflowState.loading) {
    return '<div class="border rounded p-3"><div class="skeleton" style="height: 40px;"></div></div>';
  }
  
  if (workflowState.workflows.length === 0) return '<div class="text-muted small p-3 border rounded">暂无流程</div>';
  return workflowState.workflows.map((workflow) => `
    <button class="list-group-item list-group-item-action ${workflowState.selectedWorkflowId === workflow.id ? 'active' : ''}" data-workflow-id="${workflow.id}">
      <div class="fw-semibold">${wfEscape(workflow.name)}</div>
      <div class="small">${workflow.steps.length} 个步骤</div>
    </button>
  `).join('');
}

function renderProjectOptions() {
  return workflowState.projects.map((project) => `<option value="${project.id}">${wfEscape(project.name)} (${wfEscape(project.type)})</option>`).join('');
}

function getStepTypeIcon(actionType) {
  const icons = {
    'start_project': '🚀',
    'stop_project': '⏹️',
    'command': '💻',
    'script': '📜',
    'delay': '⏱️',
    'http_request': '🌐',
    'file_operation': '📁',
    'notification': '🔔'
  };
  return icons[actionType] || '📋';
}

function getStepConfigSummary(step) {
  switch (step.action_type) {
    case 'start_project':
    case 'stop_project':
      return workflowProjectName(step.project_id);
    case 'command':
      return step.command ? step.command.substring(0, 20) + (step.command.length > 20 ? '...' : '') : '';
    case 'script':
      return step.script_path || '';
    case 'delay':
      return `${step.delay_seconds} 秒`;
    case 'http_request':
      try {
        const config = step.http_config ? JSON.parse(step.http_config) : {};
        return config.url || '';
      } catch {
        return '';
      }
    case 'file_operation':
      try {
        const config = step.file_config ? JSON.parse(step.file_config) : {};
        return config.source || '';
      } catch {
        return '';
      }
    case 'notification':
      try {
        const config = step.http_config ? JSON.parse(step.http_config) : {};
        return config.message || '';
      } catch {
        return '';
      }
    default:
      return '';
  }
}

function renderStepRows(workflow) {
  if (!workflow.steps.length) return '<tr><td colspan="8" class="text-center text-muted py-4">暂无步骤，请添加步骤。</td></tr>';
  const status = workflowState.statuses[workflow.id];
  return workflow.steps.map((step, index) => {
    const stepStatus = status?.steps?.find((item) => item.id === step.id)?.status;
    const projectStatus = workflowProjectStatus(step.project_id);
    
    let statusText = '';
    let statusClass = '';
    
    // 1. 被跳过的步骤（禁用导致跳过）
    if (stepStatus === 'skipped') {
      statusText = '已跳过';
      statusClass = 'skipped';
    }
    // 2. 启动/停止项目：显示项目运行状态
    else if (step.action_type === 'start_project' || step.action_type === 'stop_project') {
      if (stepStatus === 'running') {
        statusText = '执行中';
        statusClass = 'running';
      } else {
        statusText = projectStatus === 'running' ? '运行中' : '已停止';
        statusClass = projectStatus;
      }
    }
    // 3. 其他任务类型：显示执行状态
    else {
      if (stepStatus === 'running') {
        statusText = '执行中';
        statusClass = 'running';
      } else if (stepStatus === 'success') {
        statusText = '执行成功';
        statusClass = 'success';
      } else if (stepStatus === 'failed') {
        statusText = '执行失败';
        statusClass = 'failed';
      } else {
        statusText = '-';
        statusClass = '';
      }
    }
    
    const isEnabled = step.enabled !== 0 && step.enabled !== false;
    const isFirst = index === 0;
    const isLast = index === workflow.steps.length - 1;
    const showWorkDir = step.action_type === 'command' || step.action_type === 'script';
    
    return `
      <tr class="${isEnabled ? '' : 'table-secondary'}">
        <td class="wf-col-order">${step.step_order}</td>
        <td class="wf-col-name" title="${wfEscape(step.name)}">
          <span class="me-1">${getStepTypeIcon(step.action_type)}</span>
          <span class="text-truncate-cell">${wfEscape(step.name)}</span>
          ${!isEnabled ? '<span class="badge text-bg-secondary ms-1">已禁用</span>' : ''}
        </td>
        <td class="wf-col-config" title="${wfEscape(getStepConfigSummary(step))}">
          <div class="text-truncate-cell small text-muted">${getStepConfigSummary(step)}</div>
        </td>
        <td class="wf-col-workdir" title="${wfEscape(showWorkDir ? (step.work_dir || '-') : '-')}">
          <div class="text-truncate-cell small">${showWorkDir ? wfEscape(step.work_dir || '-') : '-'}</div>
        </td>
        <td class="wf-col-project" title="${wfEscape(workflowProjectName(step.project_id))}">
          <span class="text-truncate-cell">${wfEscape(workflowProjectName(step.project_id))}</span>
        </td>
        <td class="wf-col-status"><span class="status-dot ${statusClass}"></span><span class="status-text ${statusClass}">${wfEscape(statusText)}</span>${stepStatus === 'failed' ? `<a href="#" class="ms-1 small text-danger" data-step-log="${workflow.id}" title="查看日志">详情</a>` : ''}</td>
        <td class="wf-col-actions text-end text-nowrap">
          <button class="btn btn-sm btn-success me-1" data-step-run="${step.id}" title="执行" ${!isEnabled ? 'disabled' : ''}>▶</button>
          <button class="btn btn-sm btn-primary me-1" data-step-edit="${step.id}" title="编辑">✎</button>
          <button class="btn btn-sm btn-secondary me-1" data-step-toggle="${step.id}" title="${isEnabled ? '禁用' : '启用'}">${isEnabled ? '禁' : '启'}</button>
          <button class="btn btn-sm btn-info me-1" data-step-up="${step.id}" ${isFirst ? 'disabled' : ''} title="上移">↑</button>
          <button class="btn btn-sm btn-info me-1" data-step-down="${step.id}" ${isLast ? 'disabled' : ''} title="下移">↓</button>
          <button class="btn btn-sm btn-warning me-1" data-step-copy="${step.id}" title="复制">复</button>
          <button class="btn btn-sm btn-danger" data-step-delete="${step.id}" title="删除">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderEditor() {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  const running = Boolean(workflowState.statuses[workflow.id]?.running);
  const isOperating = workflowState.operating;
  const operatingAction = workflowState.operatingAction;
  document.getElementById('workflowEditor').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <input class="form-control form-control-sm fw-semibold" id="workflowNameInput" value="${wfEscape(workflow.name)}">
        <div class="text-muted small mt-1">自定义流程任务，支持多种任务类型。</div>
      </div>
      <div class="text-nowrap">
        <button class="btn btn-sm btn-secondary" id="saveWorkflowBtn">保存</button>
        <button class="btn btn-sm btn-success" id="runWorkflowBtn" ${running || isOperating ? 'disabled' : ''}>${isOperating && operatingAction === 'run' ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' : ''}执行</button>
        <button class="btn btn-sm btn-warning" id="stopWorkflowBtn" ${isOperating ? 'disabled' : ''}>${isOperating && operatingAction === 'stop' ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' : ''}停止</button>
        <button class="btn btn-sm btn-danger" id="deleteWorkflowBtn">删除</button>
      </div>
    </div>
    <div class="border rounded p-3 mb-3">
      <button class="btn btn-sm btn-bt w-100" id="addStepBtn">添加步骤</button>
    </div>
    <table class="table table-hover align-middle bt-table wf-table"><thead><tr><th class="wf-col-order">序号</th><th class="wf-col-name">步骤名称</th><th class="wf-col-config">配置摘要</th><th class="wf-col-workdir">工作目录</th><th class="wf-col-project">项目</th><th class="wf-col-status">状态</th><th class="wf-col-actions text-end">操作</th></tr></thead><tbody>${renderStepRows(workflow)}</tbody></table>
  `;
  document.getElementById('saveWorkflowBtn').addEventListener('click', saveWorkflowName);
  document.getElementById('runWorkflowBtn').addEventListener('click', async () => {
    workflowState.operating = true;
    workflowState.operatingAction = 'run';
    renderEditor();
    try {
      await window.projectManager.workflows.execute(workflow.id, { onFailure: 'abort' });
      await loadWorkflows();
    } catch (error) {
      console.error('流程执行错误:', error);
      alert('流程执行失败: ' + (error.message || error));
    } finally {
      workflowState.operating = false;
      workflowState.operatingAction = null;
      renderEditor();
    }
  });
  document.getElementById('stopWorkflowBtn').addEventListener('click', async () => {
    workflowState.operating = true;
    workflowState.operatingAction = 'stop';
    renderEditor();
    try {
      await window.projectManager.workflows.stop(workflow.id);
      await loadWorkflows();
    } finally {
      workflowState.operating = false;
      workflowState.operatingAction = null;
      renderEditor();
    }
  });
  document.getElementById('deleteWorkflowBtn').addEventListener('click', async () => { if (confirm('确定删除该流程吗？')) { await window.projectManager.workflows.delete(workflow.id); workflowState.selectedWorkflowId = null; await loadWorkflows(); } });
  document.getElementById('addStepBtn').addEventListener('click', addStep);
  document.querySelectorAll('[data-step-delete]').forEach((button) => button.addEventListener('click', async () => { await window.projectManager.workflows.deleteStep(Number(button.dataset.stepDelete)); await loadWorkflows(); }));
}

async function addWorkflow() {
  try {
    const name = document.getElementById('newWorkflowNameInput').value;
    if (!name?.trim()) return;
    const workflow = await window.projectManager.workflows.create({ name: name.trim(), type: 'multi', project_id: null, description: '' });
    workflowState.selectedWorkflowId = workflow.id;
    bootstrap.Modal.getInstance(document.getElementById('workflowModal'))?.hide();
    document.getElementById('newWorkflowNameInput').value = '';
    await loadWorkflows();
  } catch (error) {
    alert(error.message || '新建流程失败');
  }
}

async function saveWorkflowName() {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  const name = document.getElementById('workflowNameInput').value.trim();
  if (!workflow || !name) return;
  await window.projectManager.workflows.update(workflow.id, { name, type: workflow.type, project_id: workflow.project_id, description: workflow.description || '' });
  await loadWorkflows();
}

async function addStep() {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  
  // 清除编辑状态
  workflowState.editingStepId = null;
  document.getElementById('stepTypeSelect').value = '';
  document.getElementById('stepTypeSelect').disabled = false;
  document.getElementById('stepConfigForm').innerHTML = '';
  document.querySelector('#stepTypeModal .modal-title').textContent = '添加步骤';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('stepTypeModal')).show();
}

function renderStepConfigForm(actionType) {
  switch (actionType) {
    case 'start_project':
    case 'stop_project':
      return `
        <label class="form-label">选择项目</label>
        <select class="form-select form-select-sm" id="stepProjectSelect">
          ${renderProjectOptions()}
        </select>
      `;
    case 'command':
      return `
        <label class="form-label">命令</label>
        <textarea class="form-control form-control-sm" id="stepCommandInput" rows="3" placeholder="请输入命令"></textarea>
        <label class="form-label mt-2">工作目录</label>
        <div class="input-group">
          <input class="form-control form-control-sm" id="stepWorkDirInput" placeholder="工作目录（可选）">
          <button class="btn btn-sm btn-outline-secondary" type="button" id="selectWorkDirBtn">选择</button>
        </div>
        <label class="form-label mt-2">超时时间（秒）</label>
        <input class="form-control form-control-sm" id="stepTimeoutInput" type="number" placeholder="超时时间（可选）">
      `;
    case 'script':
      return `
        <label class="form-label">脚本路径</label>
        <div class="input-group">
          <input class="form-control form-control-sm" id="stepScriptPathInput" placeholder="脚本文件路径">
          <button class="btn btn-sm btn-outline-secondary" type="button" id="selectScriptPathBtn">选择</button>
        </div>
        <label class="form-label mt-2">解释器（可选）</label>
        <div class="input-group">
          <input class="form-control form-control-sm" id="stepInterpreterInput" placeholder="留空则自动检测">
          <button class="btn btn-sm btn-outline-secondary" type="button" id="selectInterpreterBtn">选择</button>
        </div>
        <label class="form-label mt-2">工作目录</label>
        <div class="input-group">
          <input class="form-control form-control-sm" id="stepWorkDirInput" placeholder="工作目录（可选）">
          <button class="btn btn-sm btn-outline-secondary" type="button" id="selectWorkDirBtn">选择</button>
        </div>
        <label class="form-label mt-2">超时时间（秒）</label>
        <input class="form-control form-control-sm" id="stepTimeoutInput" type="number" placeholder="超时时间（可选）">
      `;
    case 'delay':
      return `
        <label class="form-label">延迟秒数</label>
        <input class="form-control form-control-sm" id="stepDelayInput" type="number" placeholder="请输入延迟秒数">
      `;
    case 'http_request':
      return `
        <label class="form-label">URL</label>
        <input class="form-control form-control-sm" id="stepUrlInput" placeholder="https://example.com">
        <label class="form-label mt-2">方法</label>
        <select class="form-select form-control-sm" id="stepMethodSelect">
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
        <label class="form-label mt-2">Headers（JSON）</label>
        <textarea class="form-control form-control-sm" id="stepHeadersInput" rows="2" placeholder='{"Content-Type": "application/json"}'></textarea>
        <label class="form-label mt-2">Body</label>
        <textarea class="form-control form-control-sm" id="stepBodyInput" rows="2" placeholder="请求体（可选）"></textarea>
        <label class="form-label mt-2">超时时间（秒）</label>
        <input class="form-control form-control-sm" id="stepTimeoutInput" type="number" placeholder="超时时间（可选）">
      `;
    case 'file_operation':
      return `
        <label class="form-label">操作类型</label>
        <select class="form-select form-control-sm" id="stepFileOperationSelect">
          <option value="copy">复制</option>
          <option value="move">移动</option>
          <option value="delete">删除</option>
        </select>
        <label class="form-label mt-2">源路径</label>
        <div class="input-group">
          <input class="form-control form-control-sm" id="stepSourcePathInput" placeholder="源文件/目录路径">
          <button class="btn btn-sm btn-outline-secondary" type="button" id="selectSourcePathBtn">选择</button>
        </div>
        <label class="form-label mt-2">目标路径</label>
        <div class="input-group">
          <input class="form-control form-control-sm" id="stepTargetPathInput" placeholder="目标路径（复制/移动时需要）">
          <button class="btn btn-sm btn-outline-secondary" type="button" id="selectTargetPathBtn">选择</button>
        </div>
      `;
    case 'notification':
      return `
        <label class="form-label">消息内容</label>
        <textarea class="form-control form-control-sm" id="stepMessageInput" rows="2" placeholder="通知消息内容"></textarea>
        <label class="form-label mt-2">通知渠道</label>
        <select class="form-select form-control-sm" id="stepChannelSelect">
          <option value="log">日志</option>
          <option value="system">系统通知（待实现）</option>
          <option value="email">邮件（待实现）</option>
          <option value="dingtalk">钉钉（待实现）</option>
        </select>
      `;
    default:
      return '<div class="text-muted">请选择任务类型</div>';
  }
}

async function saveStep() {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  
  const actionType = document.getElementById('stepTypeSelect').value;
  if (!actionType) {
    alert('请选择任务类型');
    return;
  }
  
  const stepPayload = {
    step_order: workflow.steps.length + 1,
    name: '',
    command: '',
    work_dir: '',
    timeout: null,
    project_id: null,
    action_type: actionType,
    script_path: '',
    http_config: '',
    file_config: '',
    interpreter: '',
    enabled: true,
    delay_seconds: 0
  };
  
  switch (actionType) {
    case 'start_project':
    case 'stop_project':
      const projectId = Number(document.getElementById('stepProjectSelect').value);
      const project = workflowState.projects.find((item) => item.id === projectId);
      if (!project) {
        alert('请选择项目');
        return;
      }
      stepPayload.project_id = projectId;
      stepPayload.name = actionType === 'start_project' ? `启动 ${project.name}` : `停止 ${project.name}`;
      stepPayload.work_dir = project.path;
      break;
    case 'command':
      const command = document.getElementById('stepCommandInput').value.trim();
      if (!command) {
        alert('请输入命令');
        return;
      }
      stepPayload.command = command;
      stepPayload.name = `执行命令`;
      stepPayload.work_dir = document.getElementById('stepWorkDirInput').value.trim() || '';
      stepPayload.timeout = document.getElementById('stepTimeoutInput').value ? Number(document.getElementById('stepTimeoutInput').value) : null;
      break;
    case 'script':
      const scriptPath = document.getElementById('stepScriptPathInput').value.trim();
      if (!scriptPath) {
        alert('请输入脚本路径');
        return;
      }
      stepPayload.script_path = scriptPath;
      stepPayload.name = `执行脚本`;
      stepPayload.interpreter = document.getElementById('stepInterpreterInput').value.trim() || '';
      stepPayload.work_dir = document.getElementById('stepWorkDirInput').value.trim() || '';
      stepPayload.timeout = document.getElementById('stepTimeoutInput').value ? Number(document.getElementById('stepTimeoutInput').value) : null;
      break;
    case 'delay':
      const delaySeconds = Number(document.getElementById('stepDelayInput').value);
      if (!delaySeconds || delaySeconds <= 0) {
        alert('请输入有效的延迟秒数');
        return;
      }
      stepPayload.delay_seconds = delaySeconds;
      stepPayload.name = `等待 ${delaySeconds} 秒`;
      break;
    case 'http_request':
      const url = document.getElementById('stepUrlInput').value.trim();
      if (!url) {
        alert('请输入 URL');
        return;
      }
      const httpConfig = {
        url,
        method: document.getElementById('stepMethodSelect').value,
        headers: document.getElementById('stepHeadersInput').value.trim() || '{}',
        body: document.getElementById('stepBodyInput').value.trim() || ''
      };
      stepPayload.http_config = JSON.stringify(httpConfig);
      stepPayload.name = `HTTP ${httpConfig.method} 请求`;
      stepPayload.timeout = document.getElementById('stepTimeoutInput').value ? Number(document.getElementById('stepTimeoutInput').value) : null;
      break;
    case 'file_operation':
      const operation = document.getElementById('stepFileOperationSelect').value;
      const sourcePath = document.getElementById('stepSourcePathInput').value.trim();
      if (!sourcePath) {
        alert('请输入源路径');
        return;
      }
      const fileConfig = {
        operation,
        source: sourcePath,
        target: document.getElementById('stepTargetPathInput').value.trim() || ''
      };
      if ((operation === 'copy' || operation === 'move') && !fileConfig.target) {
        alert('请输入目标路径');
        return;
      }
      stepPayload.file_config = JSON.stringify(fileConfig);
      stepPayload.name = `${operation === 'copy' ? '复制' : operation === 'move' ? '移动' : '删除'} 文件`;
      break;
    case 'notification':
      const message = document.getElementById('stepMessageInput').value.trim();
      if (!message) {
        alert('请输入消息内容');
        return;
      }
      const notificationConfig = {
        message,
        channel: document.getElementById('stepChannelSelect').value
      };
      stepPayload.http_config = JSON.stringify(notificationConfig);
      stepPayload.name = `发送通知`;
      break;
  }
  
  if (workflowState.editingStepId) {
    // 编辑模式：更新已有步骤
    const existingStep = workflow.steps.find((s) => s.id === workflowState.editingStepId);
    if (existingStep) {
      stepPayload.step_order = existingStep.step_order;
      stepPayload.enabled = existingStep.enabled;
    }
    await window.projectManager.workflows.updateStep(workflowState.editingStepId, stepPayload);
    workflowState.editingStepId = null;
  } else {
    // 新建模式
    await window.projectManager.workflows.createStep(workflow.id, stepPayload);
  }
  bootstrap.Modal.getInstance(document.getElementById('stepTypeModal')).hide();
  await loadWorkflows();
}

async function loadWorkflows() {
  workflowState.loading = true;
  document.getElementById('workflowList').innerHTML = renderWorkflowList();
  
  try {
    const [projects, workflows] = await Promise.all([
      window.projectManager.projects.list(),
      window.projectManager.workflows.list()
    ]);
    workflowState.projects = projects;
    workflowState.workflows = workflows;
  } catch (error) {
    console.error('加载流程失败:', error);
    workflowState.projects = [];
    workflowState.workflows = [];
  } finally {
    workflowState.loading = false;
    document.getElementById('workflowList').innerHTML = renderWorkflowList();
  }
  
  if (workflowState.selectedWorkflowId) renderEditor();
  refreshWorkflowRuntimeStatuses();
}

async function refreshWorkflowRuntimeStatuses() {
  try {
    workflowState.runtimeStatuses = await window.projectManager.process.listStatuses();
  } catch (_error) {
    workflowState.runtimeStatuses = [];
  }
  if (workflowState.selectedWorkflowId) renderEditor();
}

window.workflowsPage = {
  render: renderWorkflowPage,
  async mount() {
    document.getElementById('appContent').addEventListener('click', handleWorkflowClick);
    document.getElementById('appContent').addEventListener('change', handleWorkflowChange);
    workflowState.unsubscribe = window.projectManager.workflows.onStatus((status) => { workflowState.statuses[status.workflowId] = status; refreshWorkflowRuntimeStatuses(); });
    await loadWorkflows();
  },
  unmount() {
    document.getElementById('appContent').removeEventListener('click', handleWorkflowClick);
    document.getElementById('appContent').removeEventListener('change', handleWorkflowChange);
    workflowState.unsubscribe?.();
    workflowState.unsubscribe = null;
  }
};

function handleWorkflowChange(event) {
  if (event.target.id === 'stepTypeSelect') {
    const actionType = event.target.value;
    if (actionType) {
      document.getElementById('stepConfigForm').innerHTML = renderStepConfigForm(actionType);
      bindSelectButtons(actionType);
    }
  }
}

function handleWorkflowClick(event) {
  const workflowButton = event.target.closest('[data-workflow-id]');
  if (workflowButton) {
    workflowState.selectedWorkflowId = Number(workflowButton.dataset.workflowId);
    document.getElementById('workflowList').innerHTML = renderWorkflowList();
    renderEditor();
    return;
  }
  if (event.target.closest('#addWorkflowBtn')) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('workflowModal')).show();
    return;
  }
  if (event.target.closest('#saveNewWorkflowBtn')) {
    addWorkflow();
  }
  if (event.target.closest('#stepTypeSelect')) {
    const select = event.target.closest('#stepTypeSelect');
    const actionType = select.value;
    if (actionType) {
      document.getElementById('stepConfigForm').innerHTML = renderStepConfigForm(actionType);
      bindSelectButtons(actionType);
    }
  }
  if (event.target.closest('#saveStepBtn')) {
    saveStep();
  }
  if (event.target.closest('[data-step-toggle]')) {
    const stepId = Number(event.target.closest('[data-step-toggle]').dataset.stepToggle);
    toggleStepEnabled(stepId);
  }
  if (event.target.closest('[data-step-run]')) {
    const stepId = Number(event.target.closest('[data-step-run]').dataset.stepRun);
    runSingleStep(stepId);
  }
  if (event.target.closest('[data-step-edit]')) {
    const stepId = Number(event.target.closest('[data-step-edit]').dataset.stepEdit);
    editStep(stepId);
  }
  if (event.target.closest('[data-step-up]')) {
    const stepId = Number(event.target.closest('[data-step-up]').dataset.stepUp);
    moveStepUp(stepId);
  }
  if (event.target.closest('[data-step-down]')) {
    const stepId = Number(event.target.closest('[data-step-down]').dataset.stepDown);
    moveStepDown(stepId);
  }
  if (event.target.closest('[data-step-copy]')) {
    const stepId = Number(event.target.closest('[data-step-copy]').dataset.stepCopy);
    copyStep(stepId);
  }
  if (event.target.closest('[data-step-log]')) {
    event.preventDefault();
    const workflowId = Number(event.target.closest('[data-step-log]').dataset.stepLog);
    showWorkflowLog(workflowId);
  }
}

function bindSelectButtons(actionType) {
  // 工作目录选择
  const workDirBtn = document.getElementById('selectWorkDirBtn');
  if (workDirBtn) {
    workDirBtn.onclick = async () => {
      const path = await window.projectManager.workflows.selectDirectory();
      if (path) {
        document.getElementById('stepWorkDirInput').value = path;
      }
    };
  }
  
  // 脚本路径选择
  const scriptPathBtn = document.getElementById('selectScriptPathBtn');
  if (scriptPathBtn) {
    scriptPathBtn.onclick = async () => {
      const path = await window.projectManager.workflows.selectFile();
      if (path) {
        document.getElementById('stepScriptPathInput').value = path;
      }
    };
  }
  
  // 解释器选择
  const interpreterBtn = document.getElementById('selectInterpreterBtn');
  if (interpreterBtn) {
    interpreterBtn.onclick = async () => {
      const path = await window.projectManager.workflows.selectFile();
      if (path) {
        document.getElementById('stepInterpreterInput').value = path;
      }
    };
  }
  
  // 源路径选择（支持文件和目录）
  const sourcePathBtn = document.getElementById('selectSourcePathBtn');
  if (sourcePathBtn) {
    sourcePathBtn.onclick = async () => {
      const path = await window.projectManager.workflows.selectPath();
      if (path) {
        document.getElementById('stepSourcePathInput').value = path;
      }
    };
  }
  
  // 目标路径选择（支持文件和目录）
  const targetPathBtn = document.getElementById('selectTargetPathBtn');
  if (targetPathBtn) {
    targetPathBtn.onclick = async () => {
      const path = await window.projectManager.workflows.selectPath();
      if (path) {
        document.getElementById('stepTargetPathInput').value = path;
      }
    };
  }
}

async function copyStep(stepId) {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  
  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) return;
  
  // 将当前步骤及之后的所有步骤序号+1（使用临时序号避免冲突）
  const tempOrder = -1;
  
  // 先将所有受影响的步骤改为临时序号
  for (let i = workflow.steps.length - 1; i >= step.step_order - 1; i--) {
    const s = workflow.steps[i];
    await window.projectManager.workflows.updateStep(s.id, {
      step_order: tempOrder,
      name: s.name,
      command: s.command,
      work_dir: s.work_dir,
      timeout: s.timeout,
      project_id: s.project_id,
      action_type: s.action_type,
      script_path: s.script_path,
      http_config: s.http_config,
      file_config: s.file_config,
      interpreter: s.interpreter,
      enabled: s.enabled,
      delay_seconds: s.delay_seconds
    });
  }
  
  // 将所有步骤序号+1
  for (let i = workflow.steps.length - 1; i >= step.step_order - 1; i--) {
    const s = workflow.steps[i];
    await window.projectManager.workflows.updateStep(s.id, {
      step_order: s.step_order + 1,
      name: s.name,
      command: s.command,
      work_dir: s.work_dir,
      timeout: s.timeout,
      project_id: s.project_id,
      action_type: s.action_type,
      script_path: s.script_path,
      http_config: s.http_config,
      file_config: s.file_config,
      interpreter: s.interpreter,
      enabled: s.enabled,
      delay_seconds: s.delay_seconds
    });
  }
  
  // 创建新步骤，序号为原步骤序号+1
  await window.projectManager.workflows.createStep(workflow.id, {
    step_order: step.step_order + 1,
    name: step.name + ' (副本)',
    command: step.command,
    work_dir: step.work_dir,
    timeout: step.timeout,
    project_id: step.project_id,
    action_type: step.action_type,
    script_path: step.script_path,
    http_config: step.http_config,
    file_config: step.file_config,
    interpreter: step.interpreter,
    enabled: step.enabled,
    delay_seconds: step.delay_seconds
  });
  
  await loadWorkflows();
}

async function moveStepUp(stepId) {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  
  const stepIndex = workflow.steps.findIndex((item) => item.id === stepId);
  if (stepIndex <= 0) return;
  
  const currentStep = workflow.steps[stepIndex];
  const prevStep = workflow.steps[stepIndex - 1];
  
  // 使用临时序号避免冲突
  const tempOrder = -1;
  
  // 先将当前步骤序号改为临时值
  await window.projectManager.workflows.updateStep(currentStep.id, {
    step_order: tempOrder,
    name: currentStep.name,
    command: currentStep.command,
    work_dir: currentStep.work_dir,
    timeout: currentStep.timeout,
    project_id: currentStep.project_id,
    action_type: currentStep.action_type,
    script_path: currentStep.script_path,
    http_config: currentStep.http_config,
    file_config: currentStep.file_config,
    interpreter: currentStep.interpreter,
    enabled: currentStep.enabled,
    delay_seconds: currentStep.delay_seconds
  });
  
  // 将上方步骤序号改为当前步骤原序号
  await window.projectManager.workflows.updateStep(prevStep.id, {
    step_order: currentStep.step_order,
    name: prevStep.name,
    command: prevStep.command,
    work_dir: prevStep.work_dir,
    timeout: prevStep.timeout,
    project_id: prevStep.project_id,
    action_type: prevStep.action_type,
    script_path: prevStep.script_path,
    http_config: prevStep.http_config,
    file_config: prevStep.file_config,
    interpreter: prevStep.interpreter,
    enabled: prevStep.enabled,
    delay_seconds: prevStep.delay_seconds
  });
  
  // 将当前步骤序号改为上方步骤原序号
  await window.projectManager.workflows.updateStep(currentStep.id, {
    step_order: prevStep.step_order,
    name: currentStep.name,
    command: currentStep.command,
    work_dir: currentStep.work_dir,
    timeout: currentStep.timeout,
    project_id: currentStep.project_id,
    action_type: currentStep.action_type,
    script_path: currentStep.script_path,
    http_config: currentStep.http_config,
    file_config: currentStep.file_config,
    interpreter: currentStep.interpreter,
    enabled: currentStep.enabled,
    delay_seconds: currentStep.delay_seconds
  });
  
  await loadWorkflows();
}

async function moveStepDown(stepId) {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  
  const stepIndex = workflow.steps.findIndex((item) => item.id === stepId);
  if (stepIndex >= workflow.steps.length - 1) return;
  
  const currentStep = workflow.steps[stepIndex];
  const nextStep = workflow.steps[stepIndex + 1];
  
  // 使用临时序号避免冲突
  const tempOrder = -1;
  
  // 先将当前步骤序号改为临时值
  await window.projectManager.workflows.updateStep(currentStep.id, {
    step_order: tempOrder,
    name: currentStep.name,
    command: currentStep.command,
    work_dir: currentStep.work_dir,
    timeout: currentStep.timeout,
    project_id: currentStep.project_id,
    action_type: currentStep.action_type,
    script_path: currentStep.script_path,
    http_config: currentStep.http_config,
    file_config: currentStep.file_config,
    interpreter: currentStep.interpreter,
    enabled: currentStep.enabled,
    delay_seconds: currentStep.delay_seconds
  });
  
  // 将下方步骤序号改为当前步骤原序号
  await window.projectManager.workflows.updateStep(nextStep.id, {
    step_order: currentStep.step_order,
    name: nextStep.name,
    command: nextStep.command,
    work_dir: nextStep.work_dir,
    timeout: nextStep.timeout,
    project_id: nextStep.project_id,
    action_type: nextStep.action_type,
    script_path: nextStep.script_path,
    http_config: nextStep.http_config,
    file_config: nextStep.file_config,
    interpreter: nextStep.interpreter,
    enabled: nextStep.enabled,
    delay_seconds: nextStep.delay_seconds
  });
  
  // 将当前步骤序号改为下方步骤原序号
  await window.projectManager.workflows.updateStep(currentStep.id, {
    step_order: nextStep.step_order,
    name: currentStep.name,
    command: currentStep.command,
    work_dir: currentStep.work_dir,
    timeout: currentStep.timeout,
    project_id: currentStep.project_id,
    action_type: currentStep.action_type,
    script_path: currentStep.script_path,
    http_config: currentStep.http_config,
    file_config: currentStep.file_config,
    interpreter: currentStep.interpreter,
    enabled: currentStep.enabled,
    delay_seconds: currentStep.delay_seconds
  });
  
  await loadWorkflows();
}

async function runSingleStep(stepId) {
  // 添加加载动画
  const btn = document.querySelector(`[data-step-run="${stepId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  }
  try {
    await window.projectManager.workflows.executeStep(stepId);
  } catch (error) {
    alert('步骤执行失败: ' + (error.message || error));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '▶';
    }
  }
}

async function showWorkflowLog(workflowId) {
  try {
    const history = await window.projectManager.terminal.getHistory(workflowId);
    const logText = (history || [])
      .map((item) => `[${item.type}] ${item.data}`)
      .join('')
      .trim() || '暂无日志输出';
    
    // 使用简单的模态框展示日志
    let logModal = document.getElementById('wfLogModal');
    if (!logModal) {
      logModal = document.createElement('div');
      logModal.id = 'wfLogModal';
      logModal.className = 'modal fade';
      logModal.tabIndex = -1;
      logModal.innerHTML = `
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">执行日志</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body"><pre id="wfLogContent" class="bg-dark text-light p-3 rounded" style="max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap;"></pre></div>
          </div>
        </div>
      `;
      document.body.appendChild(logModal);
    }
    document.getElementById('wfLogContent').textContent = logText;
    bootstrap.Modal.getOrCreateInstance(logModal).show();
  } catch (error) {
    alert('获取日志失败: ' + (error.message || error));
  }
}

async function editStep(stepId) {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) return;
  
  // 复用步骤类型模态框进行编辑
  workflowState.editingStepId = stepId;
  document.getElementById('stepTypeSelect').value = step.action_type;
  document.getElementById('stepTypeSelect').disabled = true;
  document.querySelector('#stepTypeModal .modal-title').textContent = '编辑步骤';
  document.getElementById('stepConfigForm').innerHTML = renderStepConfigForm(step.action_type);
  bindSelectButtons(step.action_type);
  
  // 填充已有数据
  switch (step.action_type) {
    case 'start_project':
    case 'stop_project':
      const projectSelect = document.getElementById('stepProjectSelect');
      if (projectSelect) projectSelect.value = step.project_id || '';
      break;
    case 'command':
      const cmdInput = document.getElementById('stepCommandInput');
      if (cmdInput) cmdInput.value = step.command || '';
      const cmdWorkDir = document.getElementById('stepWorkDirInput');
      if (cmdWorkDir) cmdWorkDir.value = step.work_dir || '';
      const cmdTimeout = document.getElementById('stepTimeoutInput');
      if (cmdTimeout) cmdTimeout.value = step.timeout || '';
      break;
    case 'script':
      const scriptInput = document.getElementById('stepScriptPathInput');
      if (scriptInput) scriptInput.value = step.script_path || '';
      const interpreterInput = document.getElementById('stepInterpreterInput');
      if (interpreterInput) interpreterInput.value = step.interpreter || '';
      const scriptWorkDir = document.getElementById('stepWorkDirInput');
      if (scriptWorkDir) scriptWorkDir.value = step.work_dir || '';
      const scriptTimeout = document.getElementById('stepTimeoutInput');
      if (scriptTimeout) scriptTimeout.value = step.timeout || '';
      break;
    case 'delay':
      const delayInput = document.getElementById('stepDelayInput');
      if (delayInput) delayInput.value = step.delay_seconds || '';
      break;
    case 'http_request':
      try {
        const httpConfig = step.http_config ? JSON.parse(step.http_config) : {};
        const urlInput = document.getElementById('stepUrlInput');
        if (urlInput) urlInput.value = httpConfig.url || '';
        const methodSelect = document.getElementById('stepMethodSelect');
        if (methodSelect) methodSelect.value = httpConfig.method || 'GET';
        const headersInput = document.getElementById('stepHeadersInput');
        if (headersInput) headersInput.value = httpConfig.headers || '';
        const bodyInput = document.getElementById('stepBodyInput');
        if (bodyInput) bodyInput.value = httpConfig.body || '';
        const httpTimeout = document.getElementById('stepTimeoutInput');
        if (httpTimeout) httpTimeout.value = step.timeout || '';
      } catch {}
      break;
    case 'file_operation':
      try {
        const fileConfig = step.file_config ? JSON.parse(step.file_config) : {};
        const opSelect = document.getElementById('stepFileOperationSelect');
        if (opSelect) opSelect.value = fileConfig.operation || 'copy';
        const sourceInput = document.getElementById('stepSourcePathInput');
        if (sourceInput) sourceInput.value = fileConfig.source || '';
        const targetInput = document.getElementById('stepTargetPathInput');
        if (targetInput) targetInput.value = fileConfig.target || '';
      } catch {}
      break;
    case 'notification':
      try {
        const notifConfig = step.http_config ? JSON.parse(step.http_config) : {};
        const msgInput = document.getElementById('stepMessageInput');
        if (msgInput) msgInput.value = notifConfig.message || '';
        const channelSelect = document.getElementById('stepChannelSelect');
        if (channelSelect) channelSelect.value = notifConfig.channel || 'log';
      } catch {}
      break;
  }
  
  bootstrap.Modal.getOrCreateInstance(document.getElementById('stepTypeModal')).show();
}

async function toggleStepEnabled(stepId) {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  
  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) return;
  
  // enabled 在数据库中是整数 1/0，需要正确判断
  const currentEnabled = step.enabled === 0 ? false : true;
  const newEnabled = !currentEnabled;
  
  await window.projectManager.workflows.updateStep(stepId, {
    step_order: step.step_order,
    name: step.name,
    command: step.command,
    work_dir: step.work_dir,
    timeout: step.timeout,
    project_id: step.project_id,
    action_type: step.action_type,
    script_path: step.script_path,
    http_config: step.http_config,
    file_config: step.file_config,
    interpreter: step.interpreter,
    enabled: newEnabled ? 1 : 0,
    delay_seconds: step.delay_seconds
  });
  await loadWorkflows();
}
