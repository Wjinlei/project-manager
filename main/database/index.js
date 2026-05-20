const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');
const { createRepositories } = require('./repositories');

let db;
let repositories;

function getDataDirectory() {
  return path.join(os.homedir(), '.project-manager');
}

function getDatabasePath() {
  return path.join(getDataDirectory(), 'data.db');
}

function initializeDatabase() {
  if (db) {
    return { db, repositories, databasePath: getDatabasePath() };
  }

  fs.mkdirSync(getDataDirectory(), { recursive: true });
  db = new Database(getDatabasePath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  repositories = createRepositories(db);

  return { db, repositories, databasePath: getDatabasePath() };
}

function getDatabase() {
  if (!db) {
    return initializeDatabase().db;
  }
  return db;
}

function getRepositories() {
  if (!repositories) {
    return initializeDatabase().repositories;
  }
  return repositories;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = undefined;
    repositories = undefined;
  }
}

module.exports = {
  initializeDatabase,
  getDatabase,
  getRepositories,
  closeDatabase,
  getDatabasePath,
  getDataDirectory
};
