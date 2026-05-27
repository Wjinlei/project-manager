let configsState = {
  projects: [],
  configs: [],
  editingId: null,
  loading: false
};

function configEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderConfigRows() {
  if (configsState.loading) {
    return '<tr><td colspan="6" class="py-4"><div class="skeleton" style="height: 40px;"></div></td></tr>';
  }
  
  if (configsState.configs.length === 0) {
    return '<tr><td colspan="6" class="text-center text-muted py-4">暂无配置，请添加配置文件。</td></tr>';
  }
  return configsState.configs.map((config) => `
    <tr class="${config.is_active ? 'table-success' : ''}">
      <td title="${configEscape(config.name)}"><div class="config-cell">${configEscape(config.name)}</div></td>
      <td title="${configEscape(config.project?.name || '-')}"><div class="config-cell">${configEscape(config.project?.name || '-')}</div></td>
      <td title="${configEscape(config.source_path)}"><div class="config-cell">${configEscape(config.source_path)}</div></td>
      <td title="${configEscape(config.target_path)}"><div class="config-cell">${configEscape(config.target_path)}</div></td>
      <td title="${config.is_active ? '当前激活' : '未激活'}"><div class="config-cell">${config.is_active ? '<span class="badge text-bg-success">当前激活</span>' : '<span class="badge text-bg-secondary">未激活</span>'}</div></td>
      <td class="text-center text-nowrap">
        <button class="btn btn-sm btn-info" data-config-action="preview" data-id="${config.id}">预览</button>
        <button class="btn btn-sm btn-secondary" data-config-action="edit" data-id="${config.id}">编辑</button>
        <button class="btn btn-sm btn-danger" data-config-action="delete" data-id="${config.id}">删除</button>
      </td>
    </tr>
  `).join('');
}

function renderConfigsPage() {
  return `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <div>
        <h5 class="mb-1">配置管理</h5>
        <div class="text-muted small">统一管理项目配置模板，切换配置请在项目管理中操作。</div>
      </div>
      <button class="btn btn-sm btn-bt" id="addConfigManageBtn">添加配置</button>
    </div>
    <div class="table-responsive">
      <table class="table table-hover align-middle bt-table config-table">
        <thead>
          <tr>
            <th class="col-config-name">配置名称</th>
            <th class="col-config-project">关联项目</th>
            <th class="col-config-template">模板路径</th>
            <th class="col-config-target">目标路径</th>
            <th class="col-config-status">状态</th>
            <th class="col-config-actions text-center">操作</th>
          </tr>
        </thead>
        <tbody id="configManageTableBody"></tbody>
      </table>
    </div>

    <div class="modal fade" id="configManageModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title" id="configManageModalTitle">添加配置</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="configManageForm">
              <div class="mb-3"><label class="form-label">配置名称</label><input class="form-control form-control-sm" id="configManageNameInput" required></div>
              <div class="mb-3" id="configManageProjectGroup"><label class="form-label">关联项目</label><select class="form-select form-select-sm" id="configManageProjectInput"></select><div class="form-text" id="configManageProjectHelp"></div></div>
              <div class="mb-3" id="configManagePathGroup"><label class="form-label">配置文件路径</label><div class="input-group input-group-sm"><input class="form-control" id="configManagePathInput" readonly required><button class="btn btn-secondary" type="button" id="selectConfigManagePathBtn">选择文件</button></div></div>
            </form>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="saveConfigManageBtn">保存</button></div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="configPreviewModal" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title" id="configPreviewTitle">配置预览</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body"><pre class="config-preview mb-0" id="configPreviewContent"></pre></div>
        </div>
      </div>
    </div>
  `;
}

async function loadConfigsPage() {
  configsState.loading = true;
  document.getElementById('configManageTableBody').innerHTML = renderConfigRows();
  
  try {
    configsState.projects = await window.projectManager.projects.list();
    configsState.configs = await window.projectManager.configs.listAll();
  } catch (error) {
    console.error('加载配置失败:', error);
    configsState.projects = [];
    configsState.configs = [];
  } finally {
    configsState.loading = false;
    document.getElementById('configManageTableBody').innerHTML = renderConfigRows();
  }
}

function fillProjectSelect(selectedId) {
  const select = document.getElementById('configManageProjectInput');
  const help = document.getElementById('configManageProjectHelp');
  select.innerHTML = '';
  if (configsState.projects.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '暂无项目，请先添加项目';
    select.appendChild(option);
    help.textContent = '未加载到项目，请先在项目管理页面添加项目。';
    return;
  }
  configsState.projects.forEach((project) => {
    const option = document.createElement('option');
    option.value = String(project.id);
    option.textContent = project.name || project.path || `项目 ${project.id}`;
    option.selected = Number(selectedId) === Number(project.id);
    select.appendChild(option);
  });
  help.textContent = `已加载 ${configsState.projects.length} 个项目`;
}

async function openConfigManageModal(config) {
  configsState.editingId = config?.id || null;
  if (!config) {
    configsState.projects = await window.projectManager.projects.list();
  }
  document.getElementById('configManageModalTitle').textContent = config ? '编辑配置' : '添加配置';
  document.getElementById('configManageNameInput').value = config?.name || '';
  fillProjectSelect(config?.project_id);
  document.getElementById('configManagePathInput').value = config?.target_path || '';
  document.getElementById('configManageProjectGroup').classList.toggle('d-none', Boolean(config));
  document.getElementById('configManagePathGroup').classList.toggle('d-none', Boolean(config));
  bootstrap.Modal.getOrCreateInstance(document.getElementById('configManageModal')).show();
}

async function saveConfig() {
  const name = document.getElementById('configManageNameInput').value.trim();
  if (!name) {
    alert('请输入配置名称');
    return;
  }
  if (configsState.editingId) {
    await window.projectManager.configs.update(configsState.editingId, { name });
  } else {
    const projectId = document.getElementById('configManageProjectInput').value;
    const targetPath = document.getElementById('configManagePathInput').value.trim();
    if (!projectId) {
      alert('请选择关联项目');
      return;
    }
    if (!targetPath) {
      alert('请选择配置文件路径');
      return;
    }
    await window.projectManager.configs.create(projectId, { name, target_path: targetPath });
  }
  bootstrap.Modal.getInstance(document.getElementById('configManageModal')).hide();
  await loadConfigsPage();
}

async function previewConfig(configId) {
  const config = configsState.configs.find((item) => Number(item.id) === Number(configId));
  const content = await window.projectManager.configs.preview(configId);
  document.getElementById('configPreviewTitle').textContent = `${config?.name || '配置'}预览`;
  document.getElementById('configPreviewContent').textContent = content;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('configPreviewModal')).show();
}

async function deleteConfig(configId) {
  const config = configsState.configs.find((item) => Number(item.id) === Number(configId));
  if (!confirm(`确定删除配置「${config?.name || configId}」吗？`)) {
    return;
  }
  await window.projectManager.configs.delete(configId);
  await loadConfigsPage();
}

function bindConfigEvents() {
  document.getElementById('addConfigManageBtn').addEventListener('click', () => openConfigManageModal().catch((error) => alert(error.message)));
  document.getElementById('selectConfigManagePathBtn').addEventListener('click', async () => {
    const selectedPath = await window.projectManager.configs.selectFile();
    if (selectedPath) {
      document.getElementById('configManagePathInput').value = selectedPath;
    }
  });
  document.getElementById('saveConfigManageBtn').addEventListener('click', () => saveConfig().catch((error) => alert(error.message)));
  document.getElementById('configManageTableBody').addEventListener('click', (event) => {
    const button = event.target.closest('[data-config-action]');
    if (!button) {
      return;
    }
    const configId = button.dataset.id;
    const action = button.dataset.configAction;
    if (action === 'preview') {
      previewConfig(configId).catch((error) => alert(error.message));
    } else if (action === 'edit') {
      const config = configsState.configs.find((item) => Number(item.id) === Number(configId));
      openConfigManageModal(config).catch((error) => alert(error.message));
    } else if (action === 'delete') {
      deleteConfig(configId).catch((error) => alert(error.message));
    }
  });
}

window.configsPage = {
  render: renderConfigsPage,
  async mount() {
    bindConfigEvents();
    await loadConfigsPage();
  }
};
