const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function requireLocalDatabase() {
  const host = String(process.env.DB_HOST || "").trim().toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("Database migration test hanya boleh dijalankan pada PostgreSQL lokal");
  }
}

async function scalar(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

function migrationBody(sql) {
  const withoutBegin = sql.replace(/\bBEGIN\s*;/i, "");
  const withoutCommit = withoutBegin.replace(/\bCOMMIT\s*;\s*$/i, "");
  if (withoutBegin === sql || withoutCommit === withoutBegin) {
    throw new Error("Migration 070 harus memiliki transaksi luar BEGIN/COMMIT");
  }
  return withoutCommit;
}

async function run() {
  requireLocalDatabase();
  const migrationSql = migrationBody(
    fs.readFileSync(path.join(__dirname, "../migrations/070_admin_token_version.sql"), "utf8"),
  );
  const suffix = `${process.pid}_${Date.now()}`;
  const oldRole = `session_old_${suffix}`;
  const newRole = `session_new_${suffix}`;
  const permissionKey = `session.test.${suffix}`;
  const client = await pool.connect();
  let rolledBack = false;

  try {
    await client.query("BEGIN");

    // Apply twice inside a rollback-only transaction to prove idempotency.
    await client.query(migrationSql);
    await client.query(migrationSql);

    const column = await scalar(
      client,
      `SELECT data_type, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='users' AND column_name='token_version'`,
    );
    assert.equal(column.data_type, "bigint");
    assert.match(column.column_default, /0/);
    assert.equal(column.is_nullable, "NO");

    const oldRoleRow = await client.query(
      `INSERT INTO roles (name, label, is_system)
       VALUES ($1, 'Session Old Test', false)
       RETURNING id`,
      [oldRole],
    );
    const newRoleRow = await client.query(
      `INSERT INTO roles (name, label, is_system)
       VALUES ($1, 'Session New Test', false)
       RETURNING id`,
      [newRole],
    );
    const permission = await client.query(
      `INSERT INTO permissions (key, label, grup)
       VALUES ($1, 'Session Version Test', 'session_test')
       RETURNING id`,
      [permissionKey],
    );

    const firstUser = await client.query(
      `INSERT INTO users (nama, username, password, role, status, tenant_id)
       VALUES ('Session Test 1', $1, 'password-a', $2, 'Aktif', NULL)
       RETURNING id, token_version`,
      [`session_test_1_${suffix}`, oldRole],
    );
    const firstUserId = firstUser.rows[0].id;
    assert.equal(Number(firstUser.rows[0].token_version), 0);

    await client.query("UPDATE users SET nama='Session Test Rename' WHERE id=$1", [firstUserId]);
    assert.equal(Number((await scalar(client, "SELECT token_version FROM users WHERE id=$1", [firstUserId])).token_version), 0);

    await client.query("UPDATE users SET role=$1 WHERE id=$2", [newRole, firstUserId]);
    assert.equal(Number((await scalar(client, "SELECT token_version FROM users WHERE id=$1", [firstUserId])).token_version), 1);

    const secondUser = await client.query(
      `INSERT INTO users (nama, username, password, role, status, tenant_id)
       VALUES ('Session Test 2', $1, 'password-b', $2, 'Aktif', NULL)
       RETURNING id, token_version`,
      [`session_test_2_${suffix}`, newRole],
    );
    const secondUserId = secondUser.rows[0].id;
    assert.equal(Number(secondUser.rows[0].token_version), 0);

    await client.query(
      "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)",
      [newRoleRow.rows[0].id, permission.rows[0].id],
    );
    const afterPermission = await client.query(
      "SELECT id, token_version FROM users WHERE id=ANY($1::int[]) ORDER BY id",
      [[firstUserId, secondUserId]],
    );
    assert.deepEqual(afterPermission.rows.map((row) => Number(row.token_version)), [2, 1]);

    await client.query(
      `UPDATE role_permissions
       SET permission_id = permission_id
       WHERE role_id = $1 AND permission_id = $2`,
      [newRoleRow.rows[0].id, permission.rows[0].id],
    );
    const afterNoOpPermission = await client.query(
      "SELECT id, token_version FROM users WHERE id=ANY($1::int[]) ORDER BY id",
      [[firstUserId, secondUserId]],
    );
    assert.deepEqual(afterNoOpPermission.rows.map((row) => Number(row.token_version)), [2, 1]);

    const oldRoleUsers = await scalar(
      client,
      "SELECT COUNT(*)::int AS total FROM users WHERE role=$1 AND token_version<>0",
      [oldRole],
    );
    assert.equal(oldRoleUsers.total, 0);

    await client.query("UPDATE users SET password='password-c' WHERE id=$1", [secondUserId]);
    assert.equal(Number((await scalar(client, "SELECT token_version FROM users WHERE id=$1", [secondUserId])).token_version), 2);

    await client.query("UPDATE users SET status='Nonaktif' WHERE id=$1", [secondUserId]);
    assert.equal(Number((await scalar(client, "SELECT token_version FROM users WHERE id=$1", [secondUserId])).token_version), 3);

    assert.ok(oldRoleRow.rows[0].id);
    await client.query("ROLLBACK");
    rolledBack = true;
  } finally {
    try {
      if (!rolledBack) await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  }

  console.log("PASS local PostgreSQL migration 070: 13 assertions (transaction rolled back)");
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
