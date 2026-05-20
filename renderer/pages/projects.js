const PROJECT_TYPES = ['全部', 'Go', 'Node', 'Python', 'Java', '.NET', 'PHP', 'HTML', 'Other'];

let projectsState = {
  projects: [],
  runtimeStatuses: [],
  activeType: '全部',
  keyword: '',
  editingId: null,
  configProjectId: null,
  editingConfigId: null,
  configs: [],
  terminalProjectId: null,
  terminal: null,
  fitAddon: null,
  terminalUnsubscribe: null,
  logUnsubscribe: null,
  operatingProjectId: null,
  operatingAction: null
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
    return '<tr><td colspan="7" class="text-center text-muted py-5">暂无项目，请先添加本地目录。</td></tr>';
  }

  return projects.map((project) => {
    const runtime = runtimeOf(project.id);
    const isRunning = Boolean(runtime?.running);
    const isOperating = isProjectOperating(project.id);
    const status = isRunning ? 'running' : 'stopped';
    const sourceText = runtime?.source === 'external' ? '外部' : runtime?.source === 'managed' ? '托管' : '';
    const operatingAction = isOperating ? projectsState.operatingAction : null;
    const operatingText = actionText(operatingAction, '处理中...');
    const statusClass = status === 'running' ? 'running' : status === 'error' ? 'error' : 'stopped';
    const updatedAt = formatLocalTime(project.updated_at || project.created_at || '');
    return `
      <tr>
        <td class="project-cell project-name-cell" title="${escapeHtml(`${project.name}${project.remark ? `\n${project.remark}` : ''}`)}">
          <div class="fw-semibold text-ellipsis">${escapeHtml(project.name)}</div>
          <div class="text-muted small text-ellipsis">${escapeHtml(project.remark || '无备注')}</div>
        </td>
        <td class="project-cell" title="${escapeHtml(project.type)}"><span class="badge ${typeClass(project.type)}">${escapeHtml(project.type)}</span></td>
        <td class="project-cell" title="${escapeHtml(status)}"><span class="status-dot ${statusClass}"></span><span class="status-text ${statusClass}">${escapeHtml(status)}</span>${sourceText ? `<span class="badge text-bg-light ms-1">${sourceText}</span>` : ''}</td>
        <td class="project-cell" title="${escapeHtml(runtime?.pid || '-')}">${runtime?.pid || '-'}</td>
        <td class="project-path" title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</td>
        <td class="project-cell" title="${escapeHtml(updatedAt)}">${escapeHtml(updatedAt)}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm btn-outline-success" data-action="start" data-id="${project.id}" ${isRunning || isOperating ? 'disabled' : ''}>${isOperating ? operatingText : '启动'}</button>
          <button class="btn btn-sm btn-outline-warning" data-action="stop" data-id="${project.id}" ${(!isRunning && !isOperating) || isOperating ? 'disabled' : ''}>${isOperating ? operatingText : '停止'}</button>
          <button class="btn btn-sm btn-outline-primary" data-action="restart" data-id="${project.id}" ${isOperating ? 'disabled' : ''}>${isOperating ? operatingText : '重启'}</button>
          <button class="btn btn-sm btn-outline-dark" data-action="terminal" data-id="${project.id}">终端</button>
          <button class="btn btn-sm btn-outline-secondary" data-action="configs" data-id="${project.id}">配置</button>
          <button class="btn btn-sm btn-outline-secondary" data-action="edit" data-id="${project.id}">设置</button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${project.id}">删除</button>
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
    <div class="table-responsive project-table-wrap">
      <table class="table table-hover align-middle bt-table project-table">
        <thead>
          <tr>
            <th class="col-name">项目名称</th>
            <th class="col-type">类型</th>
            <th class="col-status">状态</th>
            <th class="col-pid">PID</th>
            <th class="col-path">项目路径</th>
            <th class="col-time">更新时间</th>
            <th class="col-actions text-end">操作</th>
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
              <div class="mb-3"><label class="form-label">项目目录</label><div class="input-group input-group-sm"><input class="form-control" id="projectPathInput" required><button class="btn btn-outline-secondary" type="button" id="selectProjectPathBtn">选择目录</button></div></div>
              <div class="row g-3"><div class="col-md-6"><label class="form-label">项目名称</label><input class="form-control form-control-sm" id="projectNameInput" required></div><div class="col-md-6"><label class="form-label">项目类型</label><select class="form-select form-select-sm" id="projectTypeInput">${PROJECT_TYPES.filter((type) => type !== '全部').map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}</select></div></div>
              <div class="mt-3"><label class="form-label">备注</label><textarea class="form-control form-control-sm" id="projectRemarkInput" rows="3"></textarea></div>
              <hr>
              <div class="mb-3"><label class="form-label">启动方式</label><select class="form-select form-select-sm" id="execModeInput"><option value="file">使用执行文件路径</option><option value="command">使用执行命令</option></select></div>
              <div class="mb-3" id="execPathGroup"><label class="form-label">执行文件路径</label><div class="input-group input-group-sm"><input class="form-control" id="execPathInput"><button class="btn btn-outline-secondary" type="button" id="selectExecPathBtn">选择文件</button></div></div>
              <div class="mb-3"><label class="form-label" id="execArgsLabel">启动参数</label><input class="form-control form-control-sm" id="execArgsInput" placeholder="例如：--port 3000"></div>
              <div class="mb-3"><label class="form-label">工作目录</label><input class="form-control form-control-sm" id="execWorkDirInput" placeholder="默认使用项目目录"></div>
            </form>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="saveProjectBtn">保存</button></div>
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
                <button class="btn btn-sm btn-outline-secondary" id="copyStartCommandBtn">复制启动命令</button>
                <button class="btn btn-sm btn-outline-secondary" id="refreshTerminalBtn">刷新</button>
                <button class="btn btn-sm btn-outline-danger" id="clearProjectLogBtn">清屏</button>
              </div>
            </div>
            <div class="terminal-container terminal-container-modal" id="projectTerminalContainer"></div>
            <textarea class="form-control form-control-sm mt-2 d-none" id="startCommandOutput" rows="3" readonly></textarea>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="configModal" tabindex="-1">
      <div class="modal-dialog modal-xl">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">配置文件管理</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="d-flex justify-content-between mb-3"><span class="text-muted small">通过复制覆盖方式切换配置文件，切换前会自动备份目标文件。</span><button class="btn btn-sm btn-bt" id="addConfigBtn">添加配置</button></div>
            <div class="table-responsive">
              <table class="table table-hover align-middle bt-table">
                <thead><tr><th>名称</th><th>源文件</th><th>目标文件</th><th>状态</th><th class="text-end">操作</th></tr></thead>
                <tbody id="configTableBody"></tbody>
              </table>
            </div>
            <div class="border rounded p-3 mt-3 d-none" id="configFormPanel">
              <div class="row g-3">
                <div class="col-md-4"><label class="form-label">配置名称</label><input class="form-control form-control-sm" id="configNameInput"></div>
                <div class="col-md-4"><label class="form-label">源文件</label><div class="input-group input-group-sm"><input class="form-control" id="configSourceInput"><button class="btn btn-outline-secondary" id="selectConfigSourceBtn">选择</button></div></div>
                <div class="col-md-4"><label class="form-label">目标文件</label><div class="input-group input-group-sm"><input class="form-control" id="configTargetInput"><button class="btn btn-outline-secondary" id="selectConfigTargetBtn">选择</button></div></div>
              </div>
              <div class="mt-3 text-end"><button class="btn btn-sm btn-secondary" id="cancelConfigBtn">取消</button><button class="btn btn-sm btn-bt" id="saveConfigBtn">保存</button></div>
            </div>
            <pre class="config-preview d-none mt-3" id="configPreview"></pre>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function refreshTable() {
  try {
    projectsState.runtimeStatuses = await window.projectManager.process.listStatuses();
  } catch (_error) {
    projectsState.runtimeStatuses = [];
  }
  document.getElementById('projectTypeTabs').innerHTML = renderProjectTabs();
  document.getElementById('projectTableBody').innerHTML = renderProjectRows();
}

async function loadProjects() {
  projectsState.projects = await window.projectManager.projects.list();
  await refreshTable();
}

async function openProjectModal(project) {
  projectsState.editingId = project?.id || null;
  document.getElementById('projectModalTitle').textContent = project ? '编辑项目' : '添加项目';
  document.getElementById('projectPathInput').value = project?.path || '';
  document.getElementById('projectNameInput').value = project?.name || '';
  document.getElementById('projectTypeInput').value = project?.type || 'Other';
  document.getElementById('projectRemarkInput').value = project?.remark || '';
  document.getElementById('execModeInput').value = 'file';
  document.getElementById('execPathInput').value = '';
  document.getElementById('execArgsInput').value = '';
  document.getElementById('execWorkDirInput').value = project?.path || '';
  if (project?.id) {
    const executable = await window.projectManager.process.getExecutable(project.id);
    document.getElementById('execModeInput').value = executable?.exec_path ? 'file' : 'command';
    document.getElementById('execPathInput').value = executable?.exec_path || '';
    document.getElementById('execArgsInput').value = executable?.args || '';
    document.getElementById('execWorkDirInput').value = executable?.work_dir || project.path || '';
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('projectModal')).show();
  updateExecutableFields();
}

function updateExecutableFields() {
  const useCommand = document.getElementById('execModeInput').value === 'command';
  document.getElementById('execPathGroup').classList.toggle('d-none', useCommand);
  document.getElementById('execArgsLabel').textContent = useCommand ? '执行命令' : '启动参数';
  document.getElementById('execArgsInput').placeholder = useCommand ? '例如：pnpm dev' : '例如：--port 3000';
}

function writeTerminalText(data) {
  if (!projectsState.terminal || !data) {
    return;
  }
  projectsState.terminal.write(String(data).replaceAll('\n', '\r\n'));
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
  projectsState.terminal?.dispose();
  projectsState.terminal = null;
  projectsState.fitAddon = null;
  projectsState.terminalProjectId = null;
}

async function loadProjectLog(projectId) {
  const log = await window.projectManager.terminal.getLog(projectId);
  document.getElementById('terminalLogPath').textContent = log.logPath;
  projectsState.terminal.clear();
  if (log.content) {
    writeTerminalText(log.content);
  } else {
    writeTerminalText(`日志文件暂无内容：${log.logPath}\n`);
  }
}

async function openTerminalModal(projectId) {
  disposeProjectTerminal();
  projectsState.terminalProjectId = projectId;
  const project = projectsState.projects.find((item) => item.id === projectId);
  document.getElementById('terminalModalTitle').textContent = `项目终端 - ${project?.name || projectId}`;
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('terminalModal'));
  modal.show();
  projectsState.terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    theme: {
      background: '#000',
      foreground: '#e5e7eb'
    }
  });
  projectsState.fitAddon = new FitAddon.FitAddon();
  projectsState.terminal.loadAddon(projectsState.fitAddon);
  projectsState.terminal.open(document.getElementById('projectTerminalContainer'));
  projectsState.fitAddon.fit();
  setTimeout(() => projectsState.fitAddon?.fit(), 150);
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

function renderConfigRows() {
  if (projectsState.configs.length === 0) {
    return '<tr><td colspan="5" class="text-center text-muted py-4">暂无配置，请添加配置文件映射。</td></tr>';
  }
  return projectsState.configs.map((config) => `
    <tr class="${config.is_active ? 'table-success' : ''}">
      <td>${escapeHtml(config.name)}</td>
      <td class="project-path" title="${escapeHtml(config.source_path)}">${escapeHtml(config.source_path)}</td>
      <td class="project-path" title="${escapeHtml(config.target_path)}">${escapeHtml(config.target_path)}</td>
      <td>${config.is_active ? '<span class="badge text-bg-success">当前激活</span>' : '<span class="badge text-bg-secondary">未激活</span>'}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-success" data-config-action="switch" data-id="${config.id}">切换</button>
        <button class="btn btn-sm btn-outline-info" data-config-action="preview" data-id="${config.id}">预览</button>
        <button class="btn btn-sm btn-outline-secondary" data-config-action="edit" data-id="${config.id}">编辑</button>
        <button class="btn btn-sm btn-outline-danger" data-config-action="delete" data-id="${config.id}">删除</button>
      </td>
    </tr>
  `).join('');
}

async function loadConfigs(projectId) {
  projectsState.configProjectId = projectId;
  projectsState.configs = await window.projectManager.configs.list(projectId);
  document.getElementById('configTableBody').innerHTML = renderConfigRows();
}

async function openConfigModal(projectId) {
  await loadConfigs(projectId);
  document.getElementById('configFormPanel').classList.add('d-none');
  document.getElementById('configPreview').classList.add('d-none');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('configModal')).show();
}

function openConfigForm(config) {
  projectsState.editingConfigId = config?.id || null;
  document.getElementById('configNameInput').value = config?.name || '';
  document.getElementById('configSourceInput').value = config?.source_path || '';
  document.getElementById('configTargetInput').value = config?.target_path || '';
  document.getElementById('configFormPanel').classList.remove('d-none');
}

async function saveConfig() {
  const payload = {
    name: document.getElementById('configNameInput').value.trim(),
    source_path: document.getElementById('configSourceInput').value.trim(),
    target_path: document.getElementById('configTargetInput').value.trim()
  };
  if (!payload.name || !payload.source_path || !payload.target_path) {
    alert('请填写配置名称、源文件和目标文件');
    return;
  }
  if (projectsState.editingConfigId) {
    await window.projectManager.configs.update(projectsState.editingConfigId, payload);
  } else {
    await window.projectManager.configs.create(projectsState.configProjectId, payload);
  }
  document.getElementById('configFormPanel').classList.add('d-none');
  await loadConfigs(projectsState.configProjectId);
}

async function selectConfigFile(inputId) {
  const selected = await window.projectManager.configs.selectFile();
  if (selected) {
    document.getElementById(inputId).value = selected;
  }
}

async function switchConfig(configId) {
  const config = projectsState.configs.find((item) => item.id === configId);
  if (!confirm(`确定要将「${config.name}」复制覆盖到目标文件吗？\n目标：${config.target_path}\n切换前会自动备份当前目标文件。`)) {
    return;
  }
  const result = await window.projectManager.configs.switch(configId);
  alert(result.backupPath ? `切换成功，备份文件：${result.backupPath}` : '切换成功，目标文件此前不存在，未生成备份。');
  await loadConfigs(projectsState.configProjectId);
}

async function previewConfig(configId) {
  const content = await window.projectManager.configs.preview(configId);
  const preview = document.getElementById('configPreview');
  preview.textContent = content;
  preview.classList.remove('d-none');
}

async function copyStartCommand() {
  if (!projectsState.terminalProjectId) {
    return;
  }
  try {
    const result = await window.projectManager.terminal.getStartCommand(projectsState.terminalProjectId);
    const output = document.getElementById('startCommandOutput');
    output.value = result.command;
    output.classList.remove('d-none');
    await navigator.clipboard.writeText(result.command);
  } catch (error) {
    alert(error.message || '获取启动命令失败');
  }
}

async function clearProjectLog() {
  if (!projectsState.terminalProjectId) {
    return;
  }
  await window.projectManager.terminal.clearLog(projectsState.terminalProjectId);
  projectsState.terminal?.clear();
}

async function saveProject() {
  const payload = { path: document.getElementById('projectPathInput').value.trim(), name: document.getElementById('projectNameInput').value.trim(), type: document.getElementById('projectTypeInput').value, remark: document.getElementById('projectRemarkInput').value.trim() };
  if (!payload.path || !payload.name) { alert('请填写项目目录和项目名称'); return; }
  const useCommand = document.getElementById('execModeInput').value === 'command';
  const execPath = useCommand ? '' : document.getElementById('execPathInput').value.trim();
  const execArgs = document.getElementById('execArgsInput').value.trim();
  if (useCommand && !execArgs) { alert('请填写执行命令'); return; }
  if (!useCommand && !execPath) { alert('请填写执行文件路径'); return; }
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
  document.getElementById('copyStartCommandBtn').addEventListener('click', copyStartCommand);
  document.getElementById('refreshTerminalBtn').addEventListener('click', () => projectsState.terminalProjectId && loadProjectLog(projectsState.terminalProjectId));
  document.getElementById('clearProjectLogBtn').addEventListener('click', clearProjectLog);
  document.getElementById('addConfigBtn').addEventListener('click', () => openConfigForm());
  document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
  document.getElementById('cancelConfigBtn').addEventListener('click', () => document.getElementById('configFormPanel').classList.add('d-none'));
  document.getElementById('selectConfigSourceBtn').addEventListener('click', () => selectConfigFile('configSourceInput'));
  document.getElementById('selectConfigTargetBtn').addEventListener('click', () => selectConfigFile('configTargetInput'));
  document.getElementById('selectProjectPathBtn').addEventListener('click', selectProjectDirectory);
  document.getElementById('selectExecPathBtn').addEventListener('click', selectExecutable);
  document.getElementById('execModeInput').addEventListener('change', updateExecutableFields);
  document.getElementById('projectSearchInput').addEventListener('input', (event) => { projectsState.keyword = event.target.value; document.getElementById('projectTableBody').innerHTML = renderProjectRows(); });
  document.getElementById('projectTypeTabs').addEventListener('click', (event) => { const button = event.target.closest('[data-project-type]'); if (!button) return; projectsState.activeType = button.dataset.projectType; refreshTable(); });
  document.getElementById('projectTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'edit') await openProjectModal(projectsState.projects.find((project) => project.id === id));
    if (button.dataset.action === 'delete') await deleteProject(id);
    if (button.dataset.action === 'configs') await openConfigModal(id);
    if (button.dataset.action === 'terminal') await openTerminalModal(id);
    if (['start', 'stop', 'restart'].includes(button.dataset.action)) await runProjectAction(button.dataset.action, id);
  });
  document.getElementById('configTableBody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-config-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    const config = projectsState.configs.find((item) => item.id === id);
    if (button.dataset.configAction === 'edit') openConfigForm(config);
    if (button.dataset.configAction === 'delete') {
      if (confirm('确定删除该配置记录吗？不会删除本地文件。')) {
        await window.projectManager.configs.delete(id);
        await loadConfigs(projectsState.configProjectId);
      }
    }
    if (button.dataset.configAction === 'preview') await previewConfig(id);
    if (button.dataset.configAction === 'switch') await switchConfig(id);
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
