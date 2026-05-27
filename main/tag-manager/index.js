const { getRepositories } = require('../database');

function listTags() {
  return getRepositories().tags.findAll();
}

function getTag(id) {
  return getRepositories().tags.findById(id);
}

function createTag(payload) {
  const repositories = getRepositories();
  const existingTag = repositories.tags.findAll().find((tag) => tag.name === payload.name);
  if (existingTag) {
    throw new Error('标签名称已存在');
  }
  
  const data = {
    name: payload.name,
    color: payload.color || '#6c757d',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  return repositories.tags.create(data);
}

function updateTag(id, payload) {
  const repositories = getRepositories();
  const current = repositories.tags.findById(id);
  if (!current) {
    throw new Error('标签不存在');
  }

  const data = {
    name: payload.name || current.name,
    color: payload.color ?? current.color,
    updated_at: new Date().toISOString()
  };

  return repositories.tags.update(id, data);
}

function deleteTag(id) {
  const repositories = getRepositories();
  return repositories.tags.delete(id);
}

function listProjectTags(projectId) {
  const repositories = getRepositories();
  const projectTags = repositories.projectTags.findAll();
  const tagIds = projectTags
    .filter((pt) => Number(pt.project_id) === Number(projectId))
    .map((pt) => pt.tag_id);
  return repositories.tags.findAll().filter((tag) => tagIds.includes(tag.id));
}

function setProjectTags(projectId, tagIds) {
  const repositories = getRepositories();
  const existingProjectTags = repositories.projectTags.findAll();
  const currentTagIds = existingProjectTags
    .filter((pt) => Number(pt.project_id) === Number(projectId))
    .map((pt) => pt.id);

  currentTagIds.forEach((id) => repositories.projectTags.delete(id));

  if (Array.isArray(tagIds)) {
    tagIds.forEach((tagId) => {
      repositories.projectTags.create({
        project_id: Number(projectId),
        tag_id: Number(tagId),
        created_at: new Date().toISOString()
      });
    });
  }
}

function registerTagManagerIpc(ipcMain) {
  ipcMain.handle('tags:list', () => listTags());
  ipcMain.handle('tags:get', (_event, id) => getTag(id));
  ipcMain.handle('tags:create', (_event, payload) => createTag(payload));
  ipcMain.handle('tags:update', (_event, id, payload) => updateTag(id, payload));
  ipcMain.handle('tags:delete', (_event, id) => deleteTag(id));
  ipcMain.handle('project-tags:list', (_event, projectId) => listProjectTags(projectId));
  ipcMain.handle('project-tags:set', (_event, projectId, tagIds) => setProjectTags(projectId, tagIds));
}

module.exports = {
  listTags,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  listProjectTags,
  setProjectTags,
  registerTagManagerIpc
};
