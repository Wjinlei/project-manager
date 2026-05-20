let dashboardState = { projects: [], runtimeStatuses: [], workflows: [] };

function renderDashboardPage() {
  return `
    <div class="stat-grid mb-3">
      <div class="stat-card">
        <div class="stat-label">总项目数</div>
        <div class="stat-value" id="dashboardProjectCount">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">运行中</div>
        <div class="stat-value" id="dashboardRunningCount">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已停止</div>
        <div class="stat-value" id="dashboardStoppedCount">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">流程数</div>
        <div class="stat-value" id="dashboardWorkflowCount">0</div>
      </div>
    </div>
    <div class="table-responsive project-table-wrap">
      <table class="table table-hover align-middle bt-table project-table">
        <thead><tr><th class="col-name">项目名称</th><th class="col-type">类型</th><th class="col-status">状态</th><th class="col-path">项目路径</th></tr></thead>
        <tbody id="dashboardProjectRows"></tbody>
      </table>
    </div>
  `;
}

function dashboardEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function dashboardRuntimeOf(projectId) {
  return dashboardState.runtimeStatuses.find((status) => Number(status.projectId) === Number(projectId));
}

function renderDashboardRows() {
  if (dashboardState.projects.length === 0) {
    return '<tr><td colspan="4" class="text-center text-muted py-4">暂无项目</td></tr>';
  }
  return dashboardState.projects.map((project) => {
    const runtime = dashboardRuntimeOf(project.id);
    const isRunning = Boolean(runtime?.running) || project.status === 'running';
    const status = isRunning ? 'running' : 'stopped';
    return `
      <tr>
        <td class="project-cell" title="${dashboardEscape(project.name)}">${dashboardEscape(project.name)}</td>
        <td class="project-cell" title="${dashboardEscape(project.type)}"><span class="badge text-bg-light text-dark">${dashboardEscape(project.type)}</span></td>
        <td class="project-cell" title="${dashboardEscape(status)}"><span class="status-dot ${status}"></span><span class="status-text ${status}">${dashboardEscape(status)}</span></td>
        <td class="project-path" title="${dashboardEscape(project.path)}">${dashboardEscape(project.path)}</td>
      </tr>
    `;
  }).join('');
}

async function loadDashboard() {
  dashboardState.projects = await window.projectManager.projects.list();
  dashboardState.runtimeStatuses = await window.projectManager.process.listStatuses();
  dashboardState.workflows = await window.projectManager.workflows.list();
  const runningCount = dashboardState.projects.filter((project) => Boolean(dashboardRuntimeOf(project.id)?.running) || project.status === 'running').length;
  document.getElementById('dashboardProjectCount').textContent = dashboardState.projects.length;
  document.getElementById('dashboardRunningCount').textContent = runningCount;
  document.getElementById('dashboardStoppedCount').textContent = Math.max(0, dashboardState.projects.length - runningCount);
  document.getElementById('dashboardWorkflowCount').textContent = dashboardState.workflows.length;
  document.getElementById('dashboardProjectRows').innerHTML = renderDashboardRows();
}

window.dashboardPage = {
  render: renderDashboardPage,
  mount: loadDashboard
};
