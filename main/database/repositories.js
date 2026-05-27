const { Repository } = require('./repository');

function createRepositories(db) {
  return {
    projects: new Repository(db, 'projects', [
      'name',
      'path',
      'type',
      'status',
      'remark',
      'created_at',
      'updated_at'
    ]),
    projectExecutables: new Repository(db, 'project_executables', [
      'project_id',
      'exec_path',
      'args',
      'work_dir',
      'created_at'
    ]),
    projectConfigs: new Repository(db, 'project_configs', [
      'project_id',
      'name',
      'source_path',
      'target_path',
      'is_active',
      'created_at'
    ]),
    projectDependencies: new Repository(db, 'project_dependencies', [
      'project_id',
      'depends_on_project_id',
      'created_at'
    ]),
    workflows: new Repository(db, 'workflows', [
      'name',
      'type',
      'project_id',
      'description',
      'created_at'
    ]),
    workflowSteps: new Repository(db, 'workflow_steps', [
      'workflow_id',
      'step_order',
      'name',
      'command',
      'work_dir',
      'timeout',
      'project_id',
      'action_type',
      'health_check_type',
      'health_check_target',
      'delay_seconds',
      'script_path',
      'http_config',
      'file_config',
      'interpreter',
      'enabled'
    ]),
    scheduledTasks: new Repository(db, 'scheduled_tasks', [
      'name',
      'cron_expression',
      'task_type',
      'related_id',
      'enabled',
      'last_run_at',
      'last_result',
      'created_at'
    ]),
    taskLogs: new Repository(db, 'task_logs', [
      'task_id',
      'task_type',
      'executed_at',
      'result',
      'output',
      'duration_ms'
    ]),
    tags: new Repository(db, 'tags', [
      'name',
      'color',
      'created_at',
      'updated_at'
    ]),
    projectTags: new Repository(db, 'project_tags', [
      'project_id',
      'tag_id',
      'created_at'
    ])
  };
}

module.exports = { createRepositories };
