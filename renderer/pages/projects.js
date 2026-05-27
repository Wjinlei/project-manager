const PROJECT_TYPES = ['全部', 'Go', 'Node', 'Python', 'Java', '.NET', 'PHP', 'HTML', 'Other'];

let projectsState = {
  projects: [],
  runtimeStatuses: [],
  activeType: '全部',
  keyword: '',
  editingId: null,
  configProjectId: null,
  configs: [],
  terminalProjectId: null,
  terminal: null,
  fitAddon: null,
  terminalUnsubscribe: null,
  logUnsubscribe: null,
  terminalLogContent: '',
  operatingProjectId: null,
  operatingAction: null,
  tags: [],
  availableTags: [],
  selectedTagIds: [],
  tempSelectedTagIds: [],
  loading: false
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function ansiToHtml(value) {
  return await window.projectManager.terminal.ansiToHtml(String(value ?? ''));
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

function runtimeOf(projectId) {
  return projectsState.runtimeStatuses.find((status) => Number(status.projectId) === Number(projectId));
}

function isProjectOperating(projectId) {
  return Number(projectsState.operatingProjectId) === Number(projectId);
}

function actionText(action, fallback) {
  const map = {
    start: '启动中...',
    stop: '停止中...',
    restart: '重启中...'
  };
  return map[action] || fallback;
}

function formatLocalTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function getFilteredProjects() {
  return projectsState.projects.filter((project) => {
    const typeMatched = projectsState.activeType === '全部' || project.type === projectsState.activeType;
    const keyword = projectsState.keyword.trim().toLowerCase();
    const keywordMatched = !keyword || [project.name, project.path, project.type, project.remark]
      .some((value) => String(value || '').toLowerCase().includes(keyword));
    
    let tagMatched = true;
    if (projectsState.selectedTagIds.length > 0) {
      const projectTags = getProjectTags(project.id);
      const projectTagIds = projectTags.map((tag) => tag.id);
      tagMatched = projectsState.selectedTagIds.every((tagId) => projectTagIds.includes(tagId));
    }
    
    return typeMatched && keywordMatched && tagMatched;
  });
}

function renderProjectTabs() {
  return PROJECT_TYPES.map((type) => `
    <button class="bt-tab ${projectsState.activeType === type ? 'active' : ''}" data-project-type="${escapeHtml(type)}">
      ${escapeHtml(type === '全部' ? '全部项目' : `${type}项目`)}
    </button>
  `).join('');
}

function renderTagFilterBar() {
  if (projectsState.availableTags.length === 0) {
    return '';
  }
  
  return `
    <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
      ${projectsState.availableTags.map((tag) => {
        const isSelected = projectsState.selectedTagIds.includes(tag.id);
        return `
          <button type="button" class="btn btn-sm tag-filter-btn ${isSelected ? 'btn-primary' : 'btn-outline-secondary'}" 
                  data-filter-tag-id="${tag.id}" 
                  style="${isSelected ? `background-color: ${escapeHtml(tag.color)} !important; border-color: ${escapeHtml(tag.color)} !important; color: ${getContrastColor(tag.color)} !important` : `border-color: ${escapeHtml(tag.color)} !important; color: ${escapeHtml(tag.color)} !important; background-color: transparent !important`}; padding: 2px 8px; font-size: 12px;">
            ${escapeHtml(tag.name)}
          </button>
        `;
      }).join('')}
      ${projectsState.selectedTagIds.length > 0 ? `<button type="button" class="btn btn-sm btn-link text-muted" id="clearTagFilterBtn" style="font-size: 12px;">清除过滤</button>` : ''}
    </div>
  `;
}

function getContrastColor(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

function getProjectTags(projectId) {
  return projectsState.tags.filter((tag) => tag.projectId === Number(projectId));
}

function renderTagSelector(selectedTagIds = []) {
  if (projectsState.availableTags.length === 0) {
    return '<span class="text-muted small">暂无标签，请先到标签管理页面添加标签。</span>';
  }
  
  const selectedTags = projectsState.availableTags.filter((tag) => selectedTagIds.includes(tag.id));
  const tagsHtml = selectedTags.length > 0 
    ? selectedTags.map((tag) => `<span class="badge me-1" style="background-color: ${escapeHtml(tag.color)} !important; color: ${getContrastColor(tag.color)} !important; padding: 2px 8px; font-size: 12px;">${escapeHtml(tag.name)}</span>`).join('')
    : '<span class="text-muted small">未选择标签</span>';
  
  return `
    <div class="d-flex align-items-center gap-2">
      <div id="selectedTagsDisplay">${tagsHtml}</div>
      <button type="button" class="btn btn-sm btn-outline-secondary" id="selectTagsBtn">选择标签</button>
    </div>
  `;
}

async function openTagSelectModal() {
  projectsState.tempSelectedTagIds = [...projectsState.selectedTagIds];
  document.getElementById('tagSelectList').innerHTML = renderTagSelectList(projectsState.tempSelectedTagIds);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('tagSelectModal')).show();
}

function renderTagSelectList(selectedTagIds) {
  if (projectsState.availableTags.length === 0) {
    return '<span class="text-muted small">暂无标签，请先到标签管理页面添加标签。</span>';
  }
  
  return projectsState.availableTags.map((tag) => {
    const isSelected = selectedTagIds.includes(tag.id);
    return `
      <label class="d-flex align-items-center gap-2 p-2 border rounded" style="cursor: pointer; ${isSelected ? `background-color: ${escapeHtml(tag.color)}20; border-color: ${escapeHtml(tag.color)};` : ''}">
        <input type="checkbox" class="tag-checkbox" value="${tag.id}" ${isSelected ? 'checked' : ''}>
        <span class="badge" style="background-color: ${escapeHtml(tag.color)} !important; color: ${getContrastColor(tag.color)} !important; padding: 2px 8px; font-size: 12px;">${escapeHtml(tag.name)}</span>
      </label>
    `;
  }).join('');
}

function confirmTagSelection() {
  projectsState.selectedTagIds = [...projectsState.tempSelectedTagIds];
  const selectedTags = projectsState.availableTags.filter((tag) => projectsState.selectedTagIds.includes(tag.id));
  const tagsHtml = selectedTags.length > 0 
    ? selectedTags.map((tag) => `<span class="badge me-1" style="background-color: ${escapeHtml(tag.color)} !important; color: ${getContrastColor(tag.color)} !important; padding: 2px 8px; font-size: 12px;">${escapeHtml(tag.name)}</span>`).join('')
    : '<span class="text-muted small">未选择标签</span>';
  document.getElementById('selectedTagsDisplay').innerHTML = tagsHtml;
  bootstrap.Modal.getInstance(document.getElementById('tagSelectModal')).hide();
}

function renderProjectRows() {
  if (projectsState.loading) {
    return '<tr><td colspan="8" class="py-5"><div class="skeleton" style="height: 40px;"></div></td></tr>';
  }
  
  const projects = getFilteredProjects();
  if (projects.length === 0) {
    return '<tr><td colspan="8" class="text-center text-muted py-5">暂无项目，请先添加本地目录。</td></tr>';
  }

  return projects.map((project) => {
    const runtime = runtimeOf(project.id);
    const isRunning = Boolean(runtime?.running);
    const isOperating = isProjectOperating(project.id);
    const status = isRunning ? '运行中' : '已停止';
    const sourceText = runtime?.source === 'external' ? '外部' : runtime?.source === 'managed' ? '托管' : '';
    const operatingAction = isOperating ? projectsState.operatingAction : null;
    const operatingText = actionText(operatingAction, '处理中...');
    const statusClass = isRunning ? 'running' : 'stopped';
    const updatedAt = formatLocalTime(project.updated_at || project.created_at || '');
    const projectTags = getProjectTags(project.id);
    const tagsHtml = projectTags.length > 0 
      ? projectTags.map((tag) => `<span class="badge me-1" style="background-color: ${escapeHtml(tag.color)} !important; color: ${getContrastColor(tag.color)} !important; padding: 2px 8px; font-size: 12px;">${escapeHtml(tag.name)}</span>`).join('')
      : '-';
    return `
      <tr>
        <td class="project-cell project-name-cell" title="${escapeHtml(`${project.name}${project.remark ? `\n${project.remark}` : ''}`)}">
          <div class="fw-semibold text-ellipsis">${escapeHtml(project.name)}</div>
          <div class="text-muted small text-ellipsis">${escapeHtml(project.remark || '无备注')}</div>
        </td>
        <td class="project-cell" title="${escapeHtml(project.type)}"><span class="badge ${typeClass(project.type)}">${escapeHtml(project.type)}</span></td>
        <td class="project-cell" title="${escapeHtml(status)}"><span class="status-dot ${statusClass}"></span><span class="status-text ${statusClass}">${escapeHtml(status)}</span>${sourceText ? `<span class="badge text-bg-light ms-1">${sourceText}</span>` : ''}</td>
        <td class="project-cell" title="${escapeHtml(runtime?.pid || '-')}">${runtime?.pid || '-'}</td>
        <td class="project-cell">${tagsHtml}</td>
        <td class="project-path" title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</td>
        <td class="project-cell" title="${escapeHtml(updatedAt)}">${escapeHtml(updatedAt)}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-success" data-action="start" data-id="${project.id}" ${isRunning || isOperating ? 'disabled' : ''}>${isOperating && operatingAction === 'start' ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' : ''}启动</button>
          <button class="btn btn-sm btn-warning" data-action="stop" data-id="${project.id}" ${(!isRunning && !isOperating) || isOperating ? 'disabled' : ''}>${isOperating && operatingAction === 'stop' ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' : ''}停止</button>
          <button class="btn btn-sm btn-primary" data-action="restart" data-id="${project.id}" ${isOperating ? 'disabled' : ''}>${isOperating && operatingAction === 'restart' ? '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ' : ''}重启</button>
          <button class="btn btn-sm btn-dark" data-action="terminal" data-id="${project.id}">终端</button>
          <button class="btn btn-sm btn-secondary" data-action="configs" data-id="${project.id}">切换</button>
          <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${project.id}">设置</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${project.id}">删除</button>
        </td>
      </tr>
    `;
  }).join('');
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
    <div id="tagFilterBar">${renderTagFilterBar()}</div>
    <div class="table-responsive project-table-wrap">
      <table class="table table-hover align-middle bt-table project-table">
        <thead>
          <tr>
            <th class="col-name">项目名称</th>
            <th class="col-type">类型</th>
            <th class="col-status">状态</th>
            <th class="col-pid">PID</th>
            <th class="col-tags">标签</th>
            <th class="col-path">项目路径</th>
            <th class="col-time">更新时间</th>
            <th class="col-actions text-center">操作</th>
          </tr>
        </thead>
        <tbody id="projectTableBody">${renderProjectRows()}</tbody>
      </table>
    </div>

    <div class="modal fade" id="projectModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title" id="projectModalTitle">添加项目</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="projectForm">
              <div class="mb-3"><label class="form-label">项目目录</label><div class="input-group input-group-sm"><input class="form-control" id="projectPathInput" required><button class="btn btn-secondary" type="button" id="selectProjectPathBtn">选择目录</button></div></div>
              <div class="row g-3"><div class="col-md-6"><label class="form-label">项目名称</label><input class="form-control form-control-sm" id="projectNameInput" required></div><div class="col-md-6"><label class="form-label">项目类型</label><select class="form-select form-select-sm" id="projectTypeInput">${PROJECT_TYPES.filter((type) => type !== '全部').map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}</select></div></div>
              <div class="mt-3"><label class="form-label">备注</label><textarea class="form-control form-control-sm" id="projectRemarkInput" rows="3"></textarea></div>
              <div class="mt-3"><label class="form-label">标签</label><div class="d-flex flex-wrap gap-2" id="projectTagsSelect"></div></div>
              <hr>
              <div class="mb-3"><label class="form-label">启动方式</label><select class="form-select form-select-sm" id="execModeInput"><option value="file">使用执行文件路径</option><option value="command">使用执行命令</option></select></div>
              <div class="mb-3" id="execPathGroup"><label class="form-label">执行文件路径</label><div class="input-group input-group-sm"><input class="form-control" id="execPathInput"><button class="btn btn-secondary" type="button" id="selectExecPathBtn">选择文件</button></div></div>
              <div class="mb-3"><label class="form-label" id="execArgsLabel">启动参数</label><input class="form-control form-control-sm" id="execArgsInput" placeholder="例如：--port 3000"></div>
              <div class="mb-3"><label class="form-label">工作目录</label><input class="form-control form-control-sm" id="execWorkDirInput" placeholder="默认使用项目目录"></div>
            </form>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="saveProjectBtn">保存</button></div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="tagSelectModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">选择标签</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="d-flex flex-wrap gap-2" id="tagSelectList"></div>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="confirmTagsBtn">确定</button></div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="terminalModal" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content terminal-modal-content">
          <div class="modal-header"><h5 class="modal-title" id="terminalModalTitle">项目终端</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body terminal-modal-body">
            <div class="terminal-modal-toolbar d-flex align-items-center justify-content-between gap-2 mb-2">
              <div class="small text-muted" id="terminalLogPath"></div>
              <div class="text-nowrap">
                <button class="btn btn-sm btn-secondary" id="refreshTerminalBtn">刷新</button>
                <button class="btn btn-sm btn-danger" id="clearProjectLogBtn">清屏</button>
              </div>
            </div>
            <div class="terminal-container terminal-container-modal terminal-text-view" id="projectTerminalContainer"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="configModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title" id="configSwitchModalTitle">切换配置</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="text-muted small mb-3" id="configSwitchHelp">请选择要切换的配置。切换前会自动备份目标文件。</div>
            <div class="alert alert-info d-none" id="configSwitchEmpty">该项目暂无配置，请先到配置管理页面添加配置。</div>
            <select class="form-select form-select-sm" id="configSwitchSelect"></select>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="switchConfigBtn">确定切换</button></div>
        </div>
      </div>
    </div>
  `;
}

function renderProjectListView() {
  document.getElementById('projectTypeTabs').innerHTML = renderProjectTabs();
  document.getElementById('tagFilterBar').innerHTML = renderTagFilterBar();
  document.getElementById('projectTableBody').innerHTML = renderProjectRows();
}

async function refreshTable() {
  try {
    projectsState.runtimeStatuses = await window.projectManager.process.listStatuses();
  } catch (_error) {
    projectsState.runtimeStatuses = [];
  }
  
  const allTags = [];
  for (const project of projectsState.projects) {
    const tags = await window.projectManager.projectTags.list(project.id);
    tags.forEach((tag) => {
      allTags.push({ ...tag, projectId: project.id });
    });
  }
  projectsState.tags = allTags;
  
  renderProjectListView();
}

async function loadProjects() {
  projectsState.loading = true;
  renderProjectListView();
  
  try {
    projectsState.projects = await window.projectManager.projects.list();
    projectsState.availableTags = await window.projectManager.tags.list();
    
    const allTags = [];
    for (const project of projectsState.projects) {
      const tags = await window.projectManager.projectTags.list(project.id);
      tags.forEach((tag) => {
        allTags.push({ ...tag, projectId: project.id });
      });
    }
    projectsState.tags = allTags;
    
    await refreshTable();
  } catch (error) {
    console.error('加载项目失败:', error);
    projectsState.projects = [];
    projectsState.tags = [];
    projectsState.availableTags = [];
  } finally {
    projectsState.loading = false;
    renderProjectListView();
  }
}

async function openProjectModal(project) {
  projectsState.editingId = project?.id || null;
  projectsState.selectedTagIds = [];
  document.getElementById('projectModalTitle').textContent = project ? '编辑项目' : '添加项目';
  document.getElementById('projectPathInput').value = project?.path || '';
  document.getElementById('projectNameInput').value = project?.name || '';
  document.getElementById('projectTypeInput').value = project?.type || 'Other';
  document.getElementById('projectRemarkInput').value = project?.remark || '';
  document.getElementById('execModeInput').value = 'file';
  document.getElementById('execPathInput').value = '';
  document.getElementById('execArgsInput').value = '';
  document.getElementById('execWorkDirInput').value = project?.path || '';
  
  let selectedTagIds = [];
  if (project?.id) {
    const executable = await window.projectManager.process.getExecutable(project.id);
    document.getElementById('execModeInput').value = executable?.exec_path ? 'file' : 'command';
    document.getElementById('execPathInput').value = executable?.exec_path || '';
    document.getElementById('execArgsInput').value = executable?.args || '';
    document.getElementById('execWorkDirInput').value = executable?.work_dir || project.path || '';
    
    const projectTags = await window.projectManager.projectTags.list(project.id);
    selectedTagIds = projectTags.map((tag) => tag.id);
  }
  
  projectsState.selectedTagIds = selectedTagIds;
  document.getElementById('projectTagsSelect').innerHTML = renderTagSelector(selectedTagIds);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('projectModal')).show();
  updateExecutableFields();
}

function updateExecutableFields() {
  const useCommand = document.getElementById('execModeInput').value === 'command';
  document.getElementById('execPathGroup').classList.toggle('d-none', useCommand);
  document.getElementById('execArgsLabel').textContent = useCommand ? '执行命令' : '启动参数';
  document.getElementById('execArgsInput').placeholder = useCommand ? '例如：pnpm dev' : '例如：--port 3000';
}

async function writeTerminalText(data) {
  const container = document.getElementById('projectTerminalContainer');
  if (!container || !data) {
    return;
  }
  const shouldStickToBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 8;
  projectsState.terminalLogContent += String(data);
  container.innerHTML = await ansiToHtml(projectsState.terminalLogContent);
  if (shouldStickToBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function disposeProjectTerminal() {
  if (projectsState.terminalUnsubscribe) {
    projectsState.terminalUnsubscribe();
    projectsState.terminalUnsubscribe = null;
  }
  if (projectsState.logUnsubscribe) {
    projectsState.logUnsubscribe();
    projectsState.logUnsubscribe = null;
  }
  if (projectsState.terminalProjectId) {
    window.projectManager.terminal.unwatchLog(projectsState.terminalProjectId);
  }
  projectsState.terminal = null;
  projectsState.fitAddon = null;
  projectsState.terminalLogContent = '';
  projectsState.terminalProjectId = null;
}

async function loadProjectLog(projectId) {
  const log = await window.projectManager.terminal.getLog(projectId);
  document.getElementById('terminalLogPath').textContent = log.logPath;
  const container = document.getElementById('projectTerminalContainer');
  const content = log.content || `日志文件暂无内容：${log.logPath}\n`;
  if (projectsState.terminalLogContent !== content) {
    const shouldStickToBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 8;
    projectsState.terminalLogContent = content;
    container.innerHTML = await ansiToHtml(content);
    if (shouldStickToBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }
}

async function openTerminalModal(projectId) {
  disposeProjectTerminal();
  projectsState.terminalProjectId = projectId;
  const project = projectsState.projects.find((item) => item.id === projectId);
  document.getElementById('terminalModalTitle').textContent = `项目终端 - ${project?.name || projectId}`;
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('terminalModal'));
  modal.show();
  await loadProjectLog(projectId);
  await window.projectManager.terminal.watchLog(projectId);
  projectsState.logUnsubscribe = window.projectManager.terminal.onLogOutput((output) => {
    if (output.projectId === projectsState.terminalProjectId) {
      writeTerminalText(output.data);
    }
  });
  projectsState.terminalUnsubscribe = window.projectManager.terminal.onOutput((output) => {
    if (output.projectId === projectsState.terminalProjectId) {
      refreshTable();
    }
  });
}

async function loadConfigs(projectId) {
  projectsState.configProjectId = projectId;
  projectsState.configs = await window.projectManager.configs.list(projectId);
}

async function openProjectConfigSwitchModal(projectId) {
  if (projectsState.projects.length === 0) {
    projectsState.projects = await window.projectManager.projects.list();
  }
  await loadConfigs(projectId);
  const project = projectsState.projects.find((item) => item.id === projectId);
  const hasConfigs = projectsState.configs.length > 0;
  document.getElementById('configSwitchModalTitle').textContent = `切换配置 - ${project?.name || projectId}`;
  document.getElementById('configSwitchSelect').innerHTML = projectsState.configs.map((config) => `
    <option value="${config.id}" ${config.is_active ? 'selected' : ''}>${escapeHtml(config.name)}${config.is_active ? '（当前）' : ''}</option>
  `).join('');
  document.getElementById('configSwitchSelect').classList.toggle('d-none', !hasConfigs);
  document.getElementById('configSwitchHelp').classList.toggle('d-none', !hasConfigs);
  document.getElementById('configSwitchEmpty').classList.toggle('d-none', hasConfigs);
  document.getElementById('switchConfigBtn').disabled = !hasConfigs;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('configModal')).show();
}

async function switchSelectedConfig() {
  const configId = Number(document.getElementById('configSwitchSelect').value);
  const config = projectsState.configs.find((item) => item.id === configId);
  if (!config) {
    alert('请选择要切换的配置');
    return;
  }
  if (!confirm(`确定要将「${config.name}」复制覆盖到目标文件吗？\n目标：${config.target_path}\n切换前会自动备份当前目标文件。`)) {
    return;
  }
  const result = await window.projectManager.configs.switch(configId);
  alert(result.backupPath ? `切换成功，备份文件：${result.backupPath}` : '切换成功，目标文件此前不存在，未生成备份。');
  await loadConfigs(projectsState.configProjectId);
  bootstrap.Modal.getInstance(document.getElementById('configModal')).hide();
  await refreshTable();
}

async function clearProjectLog() {
  if (!projectsState.terminalProjectId) {
    return;
  }
  await window.projectManager.terminal.clearLog(projectsState.terminalProjectId);
  document.getElementById('projectTerminalContainer').innerHTML = '';
  projectsState.terminalLogContent = '';
}

async function saveProject() {
  const payload = { path: document.getElementById('projectPathInput').value.trim(), name: document.getElementById('projectNameInput').value.trim(), type: document.getElementById('projectTypeInput').value, remark: document.getElementById('projectRemarkInput').value.trim() };
  if (!payload.path || !payload.name) { alert('请填写项目目录和项目名称'); return; }
  const useCommand = document.getElementById('execModeInput').value === 'command';
  const execPath = useCommand ? '' : document.getElementById('execPathInput').value.trim();
  const execArgs = document.getElementById('execArgsInput').value.trim();
  if (useCommand && !execArgs) { alert('请填写执行命令'); return; }
  if (!useCommand && !execPath) { alert('请填写执行文件路径'); return; }
  
  payload.tag_ids = projectsState.selectedTagIds;
  
  const project = projectsState.editingId
    ? await window.projectManager.projects.update(projectsState.editingId, payload)
    : await window.projectManager.projects.create(payload);
  const executablePayload = { exec_path: execPath, args: execArgs, work_dir: document.getElementById('execWorkDirInput').value.trim() };
  await window.projectManager.process.saveExecutable(project.id, executablePayload);
  bootstrap.Modal.getInstance(document.getElementById('projectModal')).hide();
  await loadProjects();
}

async function selectProjectDirectory() {
  const selected = await window.projectManager.projects.selectDirectory();
  if (!selected) return;
  document.getElementById('projectPathInput').value = selected.path;
  document.getElementById('projectNameInput').value = selected.name;
  document.getElementById('projectTypeInput').value = selected.type;
  updateExecutableFields();
}

async function selectExecutable() {
  const selected = await window.projectManager.process.selectExecutable();
  if (selected) document.getElementById('execPathInput').value = selected;
}

async function deleteProject(id) {
  if (!confirm('确定要删除该项目吗？此操作只移除管理记录，不会删除本地文件。')) return;
  await window.projectManager.projects.delete(id);
  await loadProjects();
}

async function runProjectAction(action, id) {
  if (projectsState.operatingProjectId) {
    return;
  }
  projectsState.operatingProjectId = id;
  projectsState.operatingAction = action;
  document.getElementById('projectTableBody').innerHTML = renderProjectRows();
  try {
    const result = await window.projectManager.process[action](id);
    if (result?.message) {
      alert(result.message);
    }
    projectsState.projects = await window.projectManager.projects.list();
  } catch (error) {
    alert(error.message || '操作失败');
  } finally {
    projectsState.operatingProjectId = null;
    projectsState.operatingAction = null;
    await refreshTable();
  }
}

function bindProjectsEvents() {
  document.getElementById('addProjectBtn').addEventListener('click', () => openProjectModal());
  document.getElementById('saveProjectBtn').addEventListener('click', saveProject);
  document.getElementById('terminalModal').addEventListener('hidden.bs.modal', disposeProjectTerminal);
  document.getElementById('refreshTerminalBtn').addEventListener('click', () => projectsState.terminalProjectId && loadProjectLog(projectsState.terminalProjectId));
  document.getElementById('clearProjectLogBtn').addEventListener('click', clearProjectLog);
  document.getElementById('switchConfigBtn').addEventListener('click', () => switchSelectedConfig().catch((error) => alert(error.message)));
  document.getElementById('selectProjectPathBtn').addEventListener('click', selectProjectDirectory);
  document.getElementById('selectExecPathBtn').addEventListener('click', selectExecutable);
  document.getElementById('execModeInput').addEventListener('change', updateExecutableFields);
  document.getElementById('projectSearchInput').addEventListener('input', (event) => { projectsState.keyword = event.target.value; renderProjectListView(); });
  document.getElementById('projectTypeTabs').addEventListener('click', (event) => { const button = event.target.closest('[data-project-type]'); if (!button) return; projectsState.activeType = button.dataset.projectType; renderProjectListView(); });
  document.getElementById('tagFilterBar').addEventListener('click', (event) => {
    const filterBtn = event.target.closest('.tag-filter-btn');
    if (filterBtn) {
      const tagId = Number(filterBtn.dataset.filterTagId);
      const index = projectsState.selectedTagIds.indexOf(tagId);
      if (index > -1) {
        projectsState.selectedTagIds.splice(index, 1);
      } else {
        projectsState.selectedTagIds.push(tagId);
      }
      renderProjectListView();
      return;
    }
    
    const clearBtn = event.target.closest('#clearTagFilterBtn');
    if (clearBtn) {
      projectsState.selectedTagIds = [];
      renderProjectListView();
    }
  });
  document.getElementById('projectTagsSelect').addEventListener('click', (event) => {
    const selectBtn = event.target.closest('#selectTagsBtn');
    if (selectBtn) {
      openTagSelectModal();
    }
  });
  document.getElementById('tagSelectList').addEventListener('change', (event) => {
    const checkbox = event.target.closest('.tag-checkbox');
    if (checkbox) {
      const tagId = Number(checkbox.value);
      if (checkbox.checked) {
        if (!projectsState.tempSelectedTagIds.includes(tagId)) {
          projectsState.tempSelectedTagIds.push(tagId);
        }
      } else {
        const index = projectsState.tempSelectedTagIds.indexOf(tagId);
        if (index > -1) {
          projectsState.tempSelectedTagIds.splice(index, 1);
        }
      }
      document.getElementById('tagSelectList').innerHTML = renderTagSelectList(projectsState.tempSelectedTagIds);
    }
  });
  document.getElementById('confirmTagsBtn').addEventListener('click', confirmTagSelection);
  document.getElementById('projectTableBody').addEventListener('click', async (event) => {
    try {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = Number(button.dataset.id);
      if (button.dataset.action === 'edit') await openProjectModal(projectsState.projects.find((project) => project.id === id));
      if (button.dataset.action === 'delete') await deleteProject(id);
      if (button.dataset.action === 'configs') await openProjectConfigSwitchModal(id);
      if (button.dataset.action === 'terminal') await openTerminalModal(id);
      if (['start', 'stop', 'restart'].includes(button.dataset.action)) await runProjectAction(button.dataset.action, id);
    } catch (error) {
      alert(error.message || '操作失败');
    }
  });
}

window.projectsPage = {
  render: renderProjectsPage,
  async mount() {
    bindProjectsEvents();
    await loadProjects();
  },
  unmount() {
    disposeProjectTerminal();
  }
};
