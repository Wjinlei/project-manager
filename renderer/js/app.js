window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.querySelector('.app-shell').classList.toggle('sidebar-collapsed');
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
