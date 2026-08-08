const assert = require("assert/strict");
const {
  assertUnitAccess,
  getAllowedUnitIds,
  resolveActiveUnit,
} = require("../services/unitAccessService");
const {
  assignClassEnrollment,
  getClassInUnit,
} = require("../services/santriUnitService");
const {
  listVisibleSantri,
} = require("../services/santriMultiUnitService");

function accessDb({ role = "operator", allowed = [], units = [] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes("FROM users WHERE")) {
        return { rows: [{ id: 10, tenant_id: 1, role, status: "Aktif" }] };
      }
      if (sql.includes("FROM user_unit_scope")) {
        return { rows: allowed.map((unit_id) => ({ unit_id })) };
      }
      if (sql.includes("FROM unit_pendidikan WHERE")) {
        const unit = units.find((item) => Number(item.id) === Number(params[0]) && Number(item.tenant_id) === Number(params[1]));
        return { rows: unit ? [unit] : [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function request(user, values = {}) {
  return {
    user,
    tenantId: 1,
    params: values.params || {},
    body: values.body || {},
    query: values.query || {},
    headers: values.headers || {},
  };
}

async function run() {
  const smp = { id: 2, tenant_id: 1, kode: "SMP", nama: "SMP", is_active: true };
  const pondok = { id: 1, tenant_id: 1, kode: "PESANTREN", nama: "Pondok", is_active: true };

  const superDb = accessDb({ role: "superadmin", units: [smp, pondok] });
  assert.deepEqual(
    await resolveActiveUnit(request({ id: 10, tenant_id: 1, role: "lama" }), superDb),
    { mode: "ALL", tenantId: 1, unitId: null, unit: null },
    "DB role superadmin must receive Semua Unit even when JWT role is stale",
  );
  assert.equal(
    (await resolveActiveUnit(request({ id: 10, tenant_id: 1 }, { query: { unit_id: "2" } }), superDb)).unitId,
    2,
    "superadmin must enter SMP workspace",
  );
  await assert.rejects(
    () => resolveActiveUnit(
      request({ id: 10, tenant_id: 1, role: "pimpinan_yayasan" }, { query: { scope: "all" } }),
      accessDb({ role: "pimpinan_yayasan", allowed: [2], units: [smp] }),
    ),
    (error) => error.status === 403,
    "non-superadmin leadership role must not receive implicit Semua Unit",
  );

  const operatorDb = accessDb({ role: "operator", allowed: [2], units: [smp, pondok] });
  assert.equal(
    (await resolveActiveUnit(request({ id: 10, tenant_id: 1 }), operatorDb)).unitId,
    2,
    "single-unit operator must automatically resolve SMP",
  );
  await assert.rejects(
    () => resolveActiveUnit(request({ id: 10, tenant_id: 1 }, { body: { unit_id: 1 } }), operatorDb),
    (error) => error.status === 403 && error.code === "UNIT_ACCESS_DENIED",
    "spoofed Pondok unit_id must be rejected",
  );
  await assert.rejects(
    () => assertUnitAccess({ id: 10, tenant_id: 1 }, 99, 1, accessDb({ role: "operator", allowed: [2], units: [{ id: 99, tenant_id: 2, is_active: true }] })),
    (error) => error.status === 404 && error.code === "UNIT_NOT_FOUND",
    "cross-tenant unit must be hidden as not found",
  );
  assert.deepEqual(await getAllowedUnitIds({ id: 10, tenant_id: 1 }, 1, operatorDb), [2]);

  let listSql = "";
  const listDb = {
    async query(sql) {
      listSql = sql;
      return { rows: [{ id: 5, nama: "Ahmad", memberships: [{ unit_id: 1 }, { unit_id: 2 }] }] };
    },
  };
  const allRows = await listVisibleSantri({ tenantId: 1, unitId: null }, listDb);
  assert.equal(allRows.length, 1, "multi-unit identity must be counted once in Semua Unit");
  assert.match(listSql, /FROM santri_units su/);
  assert.match(listSql, /GROUP BY s\.id/);
  assert.doesNotMatch(listSql, /santri\.kelas_id = ANY/);

  const crossClassDb = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => getClassInUnit(1, 100, 2, crossClassDb),
    (error) => error.status === 403 && error.code === "CROSS_UNIT_CLASS",
    "enrollment to a class in another unit must fail",
  );

  const writes = [];
  const enrollmentDb = {
    async query(sql, params) {
      writes.push({ sql, params });
      if (sql.includes("FROM kelas")) return { rows: [{ id: 20, tenant_id: 1, unit_id: 2, nama_kelas: "8A" }] };
      if (sql.includes("FROM santri_kelas_enrollments") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: 70, kelas_id: 19 }] };
      }
      if (sql.includes("INSERT INTO santri_kelas_enrollments")) return { rows: [{ id: 71, kelas_id: 20 }] };
      return { rows: [] };
    },
  };
  await assignClassEnrollment({
    tenantId: 1,
    membership: { id: 50, tenant_id: 1, unit_id: 2, is_primary: true },
    kelasId: 20,
  }, enrollmentDb);
  assert.ok(writes.some((entry) => entry.sql.includes("status = 'moved'")), "old enrollment must be closed");
  assert.ok(writes.some((entry) => entry.sql.includes("INSERT INTO santri_kelas_enrollments")), "new enrollment must be created");

  console.log("PASS multi-unit Santri/Kelas: 11 access, isolation, count, and enrollment assertions");
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
