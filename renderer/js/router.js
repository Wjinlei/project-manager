const pageDefinitions = {
  dashboard: {
    title: '首页统计',
    render: () => window.dashboardPage.render(),
    mount: () => window.dashboardPage.mount()
  },
  projects: {
    title: '项目管理',
    render: () => window.projectsPage.render(),
    mount: () => window.projectsPage.mount(),
    unmount: () => window.projectsPage.unmount()
  },
  tags: {
    title: '标签管理',
    render: () => window.tagsPage.render(),
    mount: () => window.tagsPage.mount(),
    unmount: () => window.tagsPage.unmount()
  },
  configs: {
    title: '配置管理',
    render: () => window.configsPage.render(),
    mount: () => window.configsPage.mount()
  },
  workflows: {
    title: '流程编排',
    render: () => window.workflowsPage.render(),
    mount: () => window.workflowsPage.mount(),
    unmount: () => window.workflowsPage.unmount()
  },
  scheduler: {
    title: '计划任务',
    render: () => placeholder('计划任务', '后续将支持 Cron 和简单周期任务。')
  },
  git: {
    title: 'Git',
    render: () => placeholder('Git 集成', '后续将支持分支、提交、Diff、Pull 和 Push。')
  }
};

function placeholder(title, description) {
  return `
    <div class="placeholder-panel">
      <h5>${title}</h5>
      <p>${description}</p>
    </div>
  `;
}

window.appRouter = {
  pages: pageDefinitions,
  currentPage: null,
  async navigate(pageId) {
    if (this.currentPage?.unmount) {
      this.currentPage.unmount();
    }
    const page = pageDefinitions[pageId] || pageDefinitions.dashboard;
    this.currentPage = page;
    document.getElementById('pageTitle').textContent = page.title;
    document.getElementById('appContent').innerHTML = page.render();
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });
    if (page.mount) {
      await page.mount();
    }
  }
};
