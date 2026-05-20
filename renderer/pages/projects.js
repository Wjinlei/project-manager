const PROJECT_TYPES = ['全部', 'Go', 'Node', 'Python', 'Java', '.NET', 'PHP', 'HTML', 'Other'];

let projectsState = {
  projects: [],
  activeType: '全部',
  keyword: '',
  editingId: null
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function typeClass(type) {
  const map = {
    Go: 'text-bg-success',
    Node: 'text-bg-primary',
    Python: 'text-bg-warning',
    Java: 'text-bg-danger',
    '.NET': 'text-bg-info',
    PHP: 'text-bg-secondary',
    HTML: 'text-bg-dark',
    Other: 'text-bg-light text-dark'
  };
  return map[type] || map.Other;
}

function getFilteredProjects() {
  return projectsState.projects.filter((project) => {
    const typeMatched = projectsState.activeType === '全部' || project.type === projectsState.activeType;
    const keyword = projectsState.keyword.trim().toLowerCase();
    const keywordMatched = !keyword || [project.name, project.path, project.type, project.remark]
      .some((value) => String(value || '').toLowerCase().includes(keyword));
    return typeMatched && keywordMatched;
  });
}

function renderProjectTabs() {
  return PROJECT_TYPES.map((type) => `
    <button class="bt-tab ${projectsState.activeType === type ? 'active' : ''}" data-project-type="${escapeHtml(type)}">
      ${escapeHtml(type === '全部' ? '全部项目' : `${type}项目`)}
    </button>
  `).join('');
}

function renderProjectRows() {
  const projects = getFilteredProjects();
  if (projects.length === 0) {
    return '<tr><td colspan="6" class="text-center text-muted py-5">暂无项目，请先添加本地目录。</td></tr>';
  }

  return projects.map((project) => `
    <tr>
      <td>
        <div class="fw-semibold">${escapeHtml(project.name)}</div>
        <div class="text-muted small">${escapeHtml(project.remark || '无备注')}</div>
      </td>
      <td><span class="badge ${typeClass(project.type)}">${escapeHtml(project.type)}</span></td>
      <td><span class="status-dot ${project.status === 'running' ? 'running' : ''}"></span>${escapeHtml(project.status)}</td>
      <td class="project-path" title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</td>
      <td>${escapeHtml(project.updated_at || project.created_at || '')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary" data-action="edit" data-id="${project.id}">设置</button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${project.id}">删除</button>
      </td>
    </tr>
  `).join('');
}

function renderProjectsPage() {
  return `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <div class="bt-tabs mb-0" id="projectTypeTabs">${renderProjectTabs()}</div>
      <button class="btn btn-sm btn-bt" id="addProjectBtn">添加项目</button>
    </div>
    <div class="d-flex align-items-center gap-2 mb-3">
      <input class="form-control form-control-sm" id="projectSearchInput" type="search" placeholder="搜索项目名称、路径、类型或备注" value="${escapeHtml(projectsState.keyword)}">
      <span class="text-muted small">共 ${projectsState.projects.length} 个项目</span>
    </div>
    <div class="table-responsive">
      <table class="table table-hover align-middle bt-table">
        <thead>
          <tr>
            <th>项目名称</th>
            <th>类型</th>
            <th>状态</th>
            <th>项目路径</th>
            <th>更新时间</th>
            <th class="text-end">操作</th>
          </tr>
        </thead>
        <tbody id="projectTableBody">${renderProjectRows()}</tbody>
      </table>
    </div>

    <div class="modal fade" id="projectModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="projectModalTitle">添加项目</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="projectForm">
              <div class="mb-3">
                <label class="form-label">项目目录</label>
                <div class="input-group input-group-sm">
                  <input class="form-control" id="projectPathInput" required>
                  <button class="btn btn-outline-secondary" type="button" id="selectProjectPathBtn">选择目录</button>
                </div>
              </div>
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">项目名称</label>
                  <input class="form-control form-control-sm" id="projectNameInput" required>
                </div>
                <div class="col-md-6">
                  <label class="form-label">项目类型</label>
                  <select class="form-select form-select-sm" id="projectTypeInput">
                    ${PROJECT_TYPES.filter((type) => type !== '全部').map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="mt-3">
                <label class="form-label">备注</label>
                <textarea class="form-control form-control-sm" id="projectRemarkInput" rows="3"></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button>
            <button type="button" class="btn btn-sm btn-bt" id="saveProjectBtn">保存</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadProjects() {
  projectsState.projects = await window.projectManager.projects.list();
  document.getElementById('projectTypeTabs').innerHTML = renderProjectTabs();
  document.getElementById('projectTableBody').innerHTML = renderProjectRows();
}

function openProjectModal(project) {
  projectsState.editingId = project?.id || null;
  document.getElementById('projectModalTitle').textContent = project ? '编辑项目' : '添加项目';
  document.getElementById('projectPathInput').value = project?.path || '';
  document.getElementById('projectNameInput').value = project?.name || '';
  document.getElementById('projectTypeInput').value = project?.type || 'Other';
  document.getElementById('projectRemarkInput').value = project?.remark || '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('projectModal')).show();
}

async function saveProject() {
  const payload = {
    path: document.getElementById('projectPathInput').value.trim(),
    name: document.getElementById('projectNameInput').value.trim(),
    type: document.getElementById('projectTypeInput').value,
    remark: document.getElementById('projectRemarkInput').value.trim()
  };

  if (!payload.path || !payload.name) {
    alert('请填写项目目录和项目名称');
    return;
  }

  if (projectsState.editingId) {
    await window.projectManager.projects.update(projectsState.editingId, payload);
  } else {
    await window.projectManager.projects.create(payload);
  }

  bootstrap.Modal.getInstance(document.getElementById('projectModal')).hide();
  await loadProjects();
}

async function selectProjectDirectory() {
  const selected = await window.projectManager.projects.selectDirectory();
  if (!selected) {
    return;
  }
  document.getElementById('projectPathInput').value = selected.path;
  document.getElementById('projectNameInput').value = selected.name;
  document.getElementById('projectTypeInput').value = selected.type;
}

async function deleteProject(id) {
  if (!confirm('确定要删除该项目吗？此操作只移除管理记录，不会删除本地文件。')) {
    return;
  }
  await window.projectManager.projects.delete(id);
  await loadProjects();
}

function bindProjectsEvents() {
  document.getElementById('addProjectBtn').addEventListener('click', () => openProjectModal());
  document.getElementById('saveProjectBtn').addEventListener('click', saveProject);
  document.getElementById('selectProjectPathBtn').addEventListener('click', selectProjectDirectory);
  document.getElementById('projectSearchInput').addEventListener('input', (event) => {
    projectsState.keyword = event.target.value;
    document.getElementById('projectTableBody').innerHTML = renderProjectRows();
  });
  document.getElementById('projectTypeTabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-project-type]');
    if (!button) return;
    projectsState.activeType = button.dataset.projectType;
    document.getElementById('projectTypeTabs').innerHTML = renderProjectTabs();
    document.getElementById('projectTableBody').innerHTML = renderProjectRows();
  });
  document.getElementById('projectTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'edit') {
      openProjectModal(projectsState.projects.find((project) => project.id === id));
    }
    if (button.dataset.action === 'delete') {
      await deleteProject(id);
    }
  });
}

window.projectsPage = {
  render: renderProjectsPage,
  async mount() {
    bindProjectsEvents();
    await loadProjects();
  }
};
