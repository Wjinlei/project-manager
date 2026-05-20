window.addEventListener('DOMContentLoaded', async () => {
  const shell = document.querySelector('.app-shell');
  const settings = window.projectManager ? await window.projectManager.settings.get() : {};
  shell.classList.toggle('sidebar-collapsed', Boolean(settings.sidebarCollapsed));

  document.getElementById('sidebarToggle').addEventListener('click', async () => {
    const collapsed = shell.classList.toggle('sidebar-collapsed');
    await window.projectManager.settings.set({ sidebarCollapsed: collapsed });
  });

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      window.appRouter.navigate(item.dataset.page);
    });
  });

  if (window.projectManager) {
    const version = await window.projectManager.getVersion();
    document.getElementById('versionBadge').textContent = `v${version}`;
  }

  window.appRouter.navigate('dashboard');
});
