class Repository {
  constructor(db, tableName, fields) {
    this.db = db;
    this.tableName = tableName;
    this.fields = fields;
  }

  findAll() {
    return this.db.prepare(`SELECT * FROM ${this.tableName} ORDER BY id DESC`).all();
  }

  findById(id) {
    return this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id);
  }

  create(data) {
    const keys = this.fields.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((key) => data[key]);
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = this.db.prepare(sql).run(values);
    return this.findById(result.lastInsertRowid);
  }

  update(id, data) {
    const keys = this.fields.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
    if (keys.length === 0) {
      return this.findById(id);
    }
    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    const values = keys.map((key) => data[key]);
    this.db.prepare(`UPDATE ${this.tableName} SET ${assignments} WHERE id = ?`).run([...values, id]);
    return this.findById(id);
  }

  delete(id) {
    return this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id).changes > 0;
  }
}

module.exports = { Repository };
