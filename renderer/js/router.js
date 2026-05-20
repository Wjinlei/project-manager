const pageDefinitions = {
  dashboard: {
    title: '首页',
    render: () => `
      <div class="stat-grid mb-3">
        <div class="stat-card">
          <div class="stat-label">总项目数</div>
          <div class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">运行中</div>
          <div class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已停止</div>
          <div class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">计划任务</div>
          <div class="stat-value">0</div>
        </div>
      </div>
      <div class="placeholder-panel">
        <h5>欢迎使用本地项目管理系统</h5>
        <p>后续任务将接入项目统计、运行状态和最近活动。</p>
      </div>
    `
  },
  projects: {
    title: '项目管理',
    render: () => `
      <div class="d-flex align-items-center justify-content-between mb-3">
        <div class="bt-tabs mb-0">
          <button class="bt-tab active">全部项目</button>
          <button class="bt-tab">Go项目</button>
          <button class="bt-tab">Node项目</button>
          <button class="bt-tab">Python项目</button>
          <button class="bt-tab">Java项目</button>
          <button class="bt-tab">.NET项目</button>
        </div>
        <button class="btn btn-sm btn-bt">添加项目</button>
      </div>
      <div class="table-responsive">
        <table class="table table-hover align-middle">
          <thead>
            <tr>
              <th>项目名称</th>
              <th>类型</th>
              <th>状态</th>
              <th>项目路径</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="5" class="text-center text-muted py-5">暂无项目，请先添加本地目录。</td>
            </tr>
          </tbody>
        </table>
      </div>
    `
  },
  workflows: {
    title: '流程编排',
    render: () => placeholder('流程编排', '后续将支持单项目流程与多项目流程。')
  },
  scheduler: {
    title: '计划任务',
    render: () => placeholder('计划任务', '后续将支持 Cron 和简单周期任务。')
  },
  terminal: {
    title: '终端',
    render: () => placeholder('终端', '后续将接入 xterm.js 实时输出。')
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
  navigate(pageId) {
    const page = pageDefinitions[pageId] || pageDefinitions.dashboard;
    document.getElementById('pageTitle').textContent = page.title;
    document.getElementById('appContent').innerHTML = page.render();
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });
  }
};
