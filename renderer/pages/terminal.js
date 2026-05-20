let terminalState = {
  projects: [],
  activeProjectId: null,
  terminal: null,
  fitAddon: null,
  unsubscribe: null
};

function terminalProjectName(projectId) {
  return terminalState.projects.find((project) => project.id === Number(projectId))?.name || `项目 ${projectId}`;
}

function renderTerminalPage() {
  return `
    <div class="terminal-toolbar">
      <div class="bt-tabs mb-0" id="terminalTabs"></div>
      <button class="btn btn-sm btn-outline-secondary" id="clearTerminalBtn">清屏</button>
    </div>
    <div class="terminal-container" id="terminalContainer"></div>
  `;
}

function renderTerminalTabs(statuses) {
  if (statuses.length === 0) {
    return '<span class="text-muted small">暂无运行中项目</span>';
  }

  return statuses.map((status) => `
    <button class="bt-tab ${terminalState.activeProjectId === status.projectId ? 'active' : ''}" data-terminal-project="${status.projectId}">
      ${terminalProjectName(status.projectId)} <span class="text-muted">#${status.pid}</span>
    </button>
  `).join('');
}

function writeOutput(output) {
  if (!terminalState.terminal || output.projectId !== terminalState.activeProjectId) {
    return;
  }
  terminalState.terminal.write(output.data.replaceAll('\n', '\r\n'));
}

async function loadHistory(projectId) {
  terminalState.terminal.clear();
  const history = await window.projectManager.terminal.getHistory(projectId);
  history.forEach(writeOutput);
}

async function activateProject(projectId) {
  terminalState.activeProjectId = Number(projectId);
  await loadHistory(terminalState.activeProjectId);
  await refreshTerminalTabs();
}

async function refreshTerminalTabs() {
  const statuses = await window.projectManager.process.listStatuses();
  const tabs = document.getElementById('terminalTabs');
  tabs.innerHTML = renderTerminalTabs(statuses);

  if (!terminalState.activeProjectId && statuses.length > 0) {
    terminalState.activeProjectId = statuses[0].projectId;
    await loadHistory(terminalState.activeProjectId);
    tabs.innerHTML = renderTerminalTabs(statuses);
  }
}

function createTerminal() {
  terminalState.terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    theme: {
      background: '#111827',
      foreground: '#e5e7eb'
    }
  });
  terminalState.fitAddon = new FitAddon.FitAddon();
  terminalState.terminal.loadAddon(terminalState.fitAddon);
  terminalState.terminal.open(document.getElementById('terminalContainer'));
  terminalState.fitAddon.fit();
  window.addEventListener('resize', () => terminalState.fitAddon?.fit());
}

function bindTerminalEvents() {
  document.getElementById('terminalTabs').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-terminal-project]');
    if (!button) return;
    await activateProject(Number(button.dataset.terminalProject));
  });

  document.getElementById('clearTerminalBtn').addEventListener('click', async () => {
    if (!terminalState.activeProjectId) return;
    await window.projectManager.terminal.clear(terminalState.activeProjectId);
    terminalState.terminal.clear();
  });

  terminalState.unsubscribe = window.projectManager.terminal.onOutput((output) => {
    writeOutput(output);
    refreshTerminalTabs();
  });
}

window.terminalPage = {
  render: renderTerminalPage,
  async mount() {
    terminalState.projects = await window.projectManager.projects.list();
    createTerminal();
    bindTerminalEvents();
    await refreshTerminalTabs();
  },
  unmount() {
    if (terminalState.unsubscribe) {
      terminalState.unsubscribe();
      terminalState.unsubscribe = null;
    }
    terminalState.terminal?.dispose();
    terminalState.terminal = null;
    terminalState.fitAddon = null;
  }
};
