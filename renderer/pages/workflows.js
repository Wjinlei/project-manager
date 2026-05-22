let workflowState = { projects: [], runtimeStatuses: [], workflows: [], selectedWorkflowId: null, unsubscribe: null, statuses: {} };

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
      <div class="col-md-4">
        <div class="d-flex justify-content-between align-items-center mb-2"><h6 class="mb-0">流程列表</h6><button class="btn btn-sm btn-bt" id="addWorkflowBtn">新增流程</button></div>
        <div class="list-group" id="workflowList"></div>
      </div>
      <div class="col-md-8">
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
  `;
}

function renderWorkflowList() {
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

function renderStepRows(workflow) {
  if (!workflow.steps.length) return '<tr><td colspan="5" class="text-center text-muted py-4">暂无步骤，请从项目列表选择添加。</td></tr>';
  const status = workflowState.statuses[workflow.id];
  return workflow.steps.map((step) => {
    const stepStatus = status?.steps?.find((item) => item.id === step.id)?.status || 'waiting';
    const projectStatus = workflowProjectStatus(step.project_id);
    const title = stepStatus === 'running' ? `${projectStatus} / 执行中` : projectStatus;
    return `
      <tr>
        <td>${step.step_order}</td>
        <td>${wfEscape(step.name)}</td>
        <td>${wfEscape(workflowProjectName(step.project_id))}</td>
        <td title="${wfEscape(title)}"><span class="status-dot ${projectStatus}"></span><span class="status-text ${projectStatus}">${wfEscape(projectStatus)}</span>${stepStatus === 'running' ? '<span class="badge text-bg-light ms-1">执行中</span>' : ''}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-danger" data-step-delete="${step.id}">删除</button></td>
      </tr>
    `;
  }).join('');
}

function renderEditor() {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  if (!workflow) return;
  const running = Boolean(workflowState.statuses[workflow.id]?.running);
  document.getElementById('workflowEditor').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <input class="form-control form-control-sm fw-semibold" id="workflowNameInput" value="${wfEscape(workflow.name)}">
        <div class="text-muted small mt-1">按顺序启动所选项目。</div>
      </div>
      <div class="text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" id="saveWorkflowBtn">保存</button>
        <button class="btn btn-sm btn-outline-success" id="runWorkflowBtn" ${running ? 'disabled' : ''}>执行</button>
        <button class="btn btn-sm btn-outline-warning" id="stopWorkflowBtn" ${running ? '' : 'disabled'}>中止</button>
        <button class="btn btn-sm btn-outline-danger" id="deleteWorkflowBtn">删除</button>
      </div>
    </div>
    <div class="border rounded p-3 mb-3">
      <div class="row g-2">
        <div class="col-md-9"><select class="form-select form-select-sm" id="stepProjectInput">${renderProjectOptions()}</select></div>
        <div class="col-md-3"><button class="btn btn-sm btn-bt w-100" id="addStepBtn" ${workflowState.projects.length === 0 ? 'disabled' : ''}>添加项目步骤</button></div>
      </div>
    </div>
    <table class="table table-hover align-middle bt-table"><thead><tr><th>序号</th><th>步骤名称</th><th>项目</th><th>状态</th><th class="text-end">操作</th></tr></thead><tbody>${renderStepRows(workflow)}</tbody></table>
  `;
  document.getElementById('saveWorkflowBtn').addEventListener('click', saveWorkflowName);
  document.getElementById('runWorkflowBtn').addEventListener('click', async () => { await window.projectManager.workflows.execute(workflow.id, { onFailure: 'abort' }); await loadWorkflows(); });
  document.getElementById('stopWorkflowBtn').addEventListener('click', () => window.projectManager.workflows.stop(workflow.id));
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
  const projectId = Number(document.getElementById('stepProjectInput').value);
  const project = workflowState.projects.find((item) => item.id === projectId);
  if (!workflow || !project) return;
  await window.projectManager.workflows.createStep(workflow.id, {
    step_order: workflow.steps.length + 1,
    name: `启动 ${project.name}`,
    command: '',
    work_dir: project.path,
    timeout: '',
    project_id: project.id,
    action_type: 'start_project'
  });
  await loadWorkflows();
}

async function loadWorkflows() {
  const [projects, workflows] = await Promise.all([
    window.projectManager.projects.list(),
    window.projectManager.workflows.list()
  ]);
  workflowState.projects = projects;
  workflowState.workflows = workflows;
  document.getElementById('workflowList').innerHTML = renderWorkflowList();
  if (workflowState.selectedWorkflowId) renderEditor();
  refreshWorkflowRuntimeStatuses();
}

async function refreshWorkflowRuntimeStatuses() {
  try {
    workflowState.runtimeStatuses = await window.projectManager.process.listStatuses();
    if (workflowState.selectedWorkflowId) renderEditor();
  } catch (_error) {
    workflowState.runtimeStatuses = [];
  }
}

window.workflowsPage = {
  render: renderWorkflowPage,
  async mount() {
    document.getElementById('appContent').addEventListener('click', handleWorkflowClick);
    workflowState.unsubscribe = window.projectManager.workflows.onStatus((status) => { workflowState.statuses[status.workflowId] = status; refreshWorkflowRuntimeStatuses(); });
    await loadWorkflows();
  },
  unmount() {
    document.getElementById('appContent').removeEventListener('click', handleWorkflowClick);
    workflowState.unsubscribe?.();
    workflowState.unsubscribe = null;
  }
};

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
}
