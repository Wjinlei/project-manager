let tagsState = {
  tags: [],
  editingId: null
};

const TAG_COLORS = [
  '#6c757d',
  '#0d6efd',
  '#198754',
  '#dc3545',
  '#ffc107',
  '#0dcaf0',
  '#6610f2',
  '#d63384'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderTagPage() {
  return `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h5 class="mb-0">标签管理</h5>
      <button class="btn btn-sm btn-bt" id="addTagBtn">新增标签</button>
    </div>
    <div class="card">
      <div class="card-body p-0">
        <table class="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>标签名称</th>
              <th>颜色</th>
              <th>关联项目数</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody id="tagTableBody"></tbody>
        </table>
      </div>
    </div>
    <div class="modal fade" id="tagModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title" id="tagModalTitle">新增标签</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">标签名称</label>
              <input type="text" class="form-control form-control-sm" id="tagNameInput" placeholder="请输入标签名称">
            </div>
            <div class="mb-3">
              <label class="form-label">标签颜色</label>
              <div class="d-flex gap-2 flex-wrap align-items-center mb-2" id="tagColorPicker">
                ${TAG_COLORS.map((color) => `
                  <button type="button" class="btn color-btn rounded-circle" style="width: 32px; height: 32px; background-color: ${color}; border: 2px solid ${color === '#6c757d' ? '#000' : 'transparent'};" data-color="${color}"></button>
                `).join('')}
              </div>
              <div class="d-flex gap-2 align-items-center">
                <input type="color" class="form-control form-control-color" id="tagColorInput" value="#6c757d" style="width: 60px; height: 38px;">
                <input type="text" class="form-control form-control-sm" id="tagColorText" value="#6c757d" placeholder="#6c757d" style="width: 100px;">
              </div>
            </div>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">取消</button><button type="button" class="btn btn-sm btn-bt" id="saveTagBtn">保存</button></div>
        </div>
      </div>
    </div>
  `;
}

function renderTagRows() {
  if (tagsState.tags.length === 0) {
    return '<tr><td colspan="4" class="text-center text-muted py-5">暂无标签，请先添加标签。</td></tr>';
  }

  return tagsState.tags.map((tag) => `
    <tr>
      <td>
        <span class="badge" style="background-color: ${escapeHtml(tag.color)}; color: ${getContrastColor(tag.color)}">${escapeHtml(tag.name)}</span>
      </td>
      <td class="align-middle">
        <span class="color-preview rounded-circle d-inline-block" style="width: 20px; height: 20px; background-color: ${escapeHtml(tag.color)}; vertical-align: middle;"></span>
        <span class="ms-2 small text-muted" style="vertical-align: middle;">${escapeHtml(tag.color)}</span>
      </td>
      <td class="align-middle">${tag.projectCount || 0}</td>
      <td class="text-end align-middle">
        <button class="btn btn-sm btn-outline-primary" data-action="edit" data-id="${tag.id}">编辑</button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${tag.id}">删除</button>
      </td>
    </tr>
  `).join('');
}

function getContrastColor(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

async function loadTags() {
  try {
    const tags = await window.projectManager.tags.list();
    const projects = await window.projectManager.projects.list();
    
    const tagsWithCount = await Promise.all(
      tags.map(async (tag) => {
        let projectCount = 0;
        for (const project of projects) {
          const projectTags = await window.projectManager.projectTags.list(project.id);
          if (projectTags.some((t) => t.id === tag.id)) {
            projectCount++;
          }
        }
        return {
          ...tag,
          projectCount
        };
      })
    );
    
    tagsState.tags = tagsWithCount;
  } catch (error) {
    console.error('加载标签失败:', error);
    tagsState.tags = [];
  }
  document.getElementById('tagTableBody').innerHTML = renderTagRows();
}

async function openTagModal(tag) {
  tagsState.editingId = tag?.id || null;
  document.getElementById('tagModalTitle').textContent = tag ? '编辑标签' : '新增标签';
  document.getElementById('tagNameInput').value = tag?.name || '';
  const color = tag?.color || '#6c757d';
  document.getElementById('tagColorInput').value = color;
  document.getElementById('tagColorText').value = color;
  updateColorSelection(color);
  
  const colorInput = document.getElementById('tagColorInput');
  const colorText = document.getElementById('tagColorText');
  
  colorInput.oninput = (e) => {
    colorText.value = e.target.value;
    updateColorSelection(e.target.value);
  };
  
  colorText.oninput = (e) => {
    const value = e.target.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      colorInput.value = value;
      updateColorSelection(value);
    }
  };
  
  const modal = bootstrap.Modal.getInstance(document.getElementById('tagModal'));
  if (modal) {
    modal.dispose();
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('tagModal')).show();
}

function updateColorSelection(selectedColor) {
  document.querySelectorAll('.color-btn').forEach((btn) => {
    const color = btn.dataset.color;
    btn.style.border = color === selectedColor ? '3px solid #000' : '2px solid transparent';
  });
}

async function saveTag() {
  const name = document.getElementById('tagNameInput').value.trim();
  const color = document.getElementById('tagColorInput').value;
  
  if (!name) {
    alert('请输入标签名称');
    return;
  }

  try {
    if (tagsState.editingId) {
      await window.projectManager.tags.update(tagsState.editingId, { name, color });
    } else {
      await window.projectManager.tags.create({ name, color });
    }
    bootstrap.Modal.getInstance(document.getElementById('tagModal')).hide();
    await loadTags();
  } catch (error) {
    alert(error.message || '保存标签失败');
  }
}

async function deleteTag(id) {
  if (!confirm('确定删除该标签吗？删除后将自动解除所有项目与该标签的关联。')) {
    return;
  }

  try {
    await window.projectManager.tags.delete(id);
    await loadTags();
  } catch (error) {
    alert(error.message || '删除标签失败');
  }
}

window.tagsPage = {
  render: renderTagPage,
  async mount() {
    document.getElementById('appContent').addEventListener('click', handleTagClick);
    document.getElementById('appContent').addEventListener('click', handleColorPickerClick);
    await loadTags();
  },
  unmount() {
    document.getElementById('appContent').removeEventListener('click', handleTagClick);
    document.getElementById('appContent').removeEventListener('click', handleColorPickerClick);
  }
};

function handleTagClick(event) {
  const addBtn = event.target.closest('#addTagBtn');
  if (addBtn) {
    openTagModal();
    return;
  }

  const actionBtn = event.target.closest('[data-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    const id = Number(actionBtn.dataset.id);
    const tag = tagsState.tags.find((t) => t.id === id);
    
    if (action === 'edit') {
      openTagModal(tag);
    } else if (action === 'delete') {
      deleteTag(id);
    }
    return;
  }

  const saveBtn = event.target.closest('#saveTagBtn');
  if (saveBtn) {
    saveTag();
  }
}

function handleColorPickerClick(event) {
  const colorBtn = event.target.closest('.color-btn');
  if (colorBtn) {
    const color = colorBtn.dataset.color;
    document.getElementById('tagColorInput').value = color;
    document.getElementById('tagColorText').value = color;
    updateColorSelection(color);
  }
}
