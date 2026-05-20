let workflowState = { projects: [], workflows: [], selectedWorkflowId: null, unsubscribe: null, statuses: {} };

function wfEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function workflowProjectName(projectId) {
  return workflowState.projects.find((project) => project.id === projectId)?.name || '-';
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
  `;
}

function renderWorkflowList() {
  if (workflowState.workflows.length === 0) return '<div class="text-muted small p-3 border rounded">暂无流程</div>';
  return workflowState.workflows.map((workflow) => `
    <button class="list-group-item list-group-item-action ${workflowState.selectedWorkflowId === workflow.id ? 'active' : ''}" data-workflow-id="${workflow.id}">
      <div class="fw-semibold">${wfEscape(workflow.name)}</div>
      <div class="small">${wfEscape(workflowProjectName(workflow.project_id))} · ${workflow.steps.length} 个步骤</div>
    </button>
  `).join('');
}

function renderStepRows(workflow) {
  if (!workflow.steps.length) return '<tr><td colspan="6" class="text-center text-muted py-4">暂无步骤</td></tr>';
  const status = workflowState.statuses[workflow.id];
  return workflow.steps.map((step) => {
    const stepStatus = status?.steps?.find((item) => item.id === step.id)?.status || 'waiting';
    return `
      <tr>
        <td>${step.step_order}</td><td>${wfEscape(step.name)}</td><td>${wfEscape(step.command)}</td><td>${wfEscape(step.work_dir || '')}</td><td>${step.timeout || '-'}</td><td><span class="badge text-bg-secondary">${wfEscape(stepStatus)}</span></td>
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
      <div><h5 class="mb-1">${wfEscape(workflow.name)}</h5><div class="text-muted small">项目：${wfEscape(workflowProjectName(workflow.project_id))}</div></div>
      <div><button class="btn btn-sm btn-outline-success" id="runWorkflowBtn" ${running ? 'disabled' : ''}>执行</button><button class="btn btn-sm btn-outline-warning" id="stopWorkflowBtn" ${running ? '' : 'disabled'}>中止</button><button class="btn btn-sm btn-outline-danger" id="deleteWorkflowBtn">删除流程</button></div>
    </div>
    <div class="border rounded p-3 mb-3">
      <div class="row g-2">
        <div class="col-md-2"><input class="form-control form-control-sm" id="stepOrderInput" type="number" placeholder="序号"></div>
        <div class="col-md-2"><input class="form-control form-control-sm" id="stepNameInput" placeholder="步骤名"></div>
        <div class="col-md-4"><input class="form-control form-control-sm" id="stepCommandInput" placeholder="命令"></div>
        <div class="col-md-2"><input class="form-control form-control-sm" id="stepWorkDirInput" placeholder="工作目录"></div>
        <div class="col-md-1"><input class="form-control form-control-sm" id="stepTimeoutInput" type="number" placeholder="超时"></div>
        <div class="col-md-1"><button class="btn btn-sm btn-bt w-100" id="addStepBtn">添加</button></div>
      </div>
    </div>
    <table class="table table-hover align-middle bt-table"><thead><tr><th>序号</th><th>名称</th><th>命令</th><th>工作目录</th><th>超时(s)</th><th>状态</th><th class="text-end">操作</th></tr></thead><tbody>${renderStepRows(workflow)}</tbody></table>
  `;
  document.getElementById('runWorkflowBtn').addEventListener('click', () => window.projectManager.workflows.execute(workflow.id, { onFailure: 'abort' }));
  document.getElementById('stopWorkflowBtn').addEventListener('click', () => window.projectManager.workflows.stop(workflow.id));
  document.getElementById('deleteWorkflowBtn').addEventListener('click', async () => { if (confirm('确定删除该流程吗？')) { await window.projectManager.workflows.delete(workflow.id); workflowState.selectedWorkflowId = null; await loadWorkflows(); } });
  document.getElementById('addStepBtn').addEventListener('click', addStep);
  document.querySelectorAll('[data-step-delete]').forEach((button) => button.addEventListener('click', async () => { await window.projectManager.workflows.deleteStep(Number(button.dataset.stepDelete)); await loadWorkflows(); }));
}

async function addWorkflow() {
  const name = prompt('流程名称');
  if (!name) return;
  const projectId = workflowState.projects[0]?.id || null;
  const workflow = await window.projectManager.workflows.create({ name, type: 'single', project_id: projectId, description: '' });
  workflowState.selectedWorkflowId = workflow.id;
  await loadWorkflows();
}

async function addStep() {
  const workflow = workflowState.workflows.find((item) => item.id === workflowState.selectedWorkflowId);
  await window.projectManager.workflows.createStep(workflow.id, {
    step_order: Number(document.getElementById('stepOrderInput').value || workflow.steps.length + 1),
    name: document.getElementById('stepNameInput').value || '未命名步骤',
    command: document.getElementById('stepCommandInput').value,
    work_dir: document.getElementById('stepWorkDirInput').value,
    timeout: document.getElementById('stepTimeoutInput').value,
    project_id: workflow.project_id
  });
  await loadWorkflows();
}

async function loadWorkflows() {
  workflowState.projects = await window.projectManager.projects.list();
  workflowState.workflows = await window.projectManager.workflows.list();
  document.getElementById('workflowList').innerHTML = renderWorkflowList();
  document.querySelectorAll('[data-workflow-id]').forEach((button) => button.addEventListener('click', () => { workflowState.selectedWorkflowId = Number(button.dataset.workflowId); document.getElementById('workflowList').innerHTML = renderWorkflowList(); renderEditor(); }));
  if (workflowState.selectedWorkflowId) renderEditor();
}

window.workflowsPage = {
  render: renderWorkflowPage,
  async mount() {
    document.getElementById('addWorkflowBtn').addEventListener('click', addWorkflow);
    workflowState.unsubscribe = window.projectManager.workflows.onStatus((status) => { workflowState.statuses[status.workflowId] = status; renderEditor(); });
    await loadWorkflows();
  },
  unmount() {
    workflowState.unsubscribe?.();
    workflowState.unsubscribe = null;
  }
};
