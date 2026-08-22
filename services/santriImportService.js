const XLSX = require("xlsx");
const pool = require("../db");
const waliAppService = require("./waliAppService");
const { syncWaliFromSantri } = require("./waliSyncService");
const {
  createMembershipWithEnrollment,
  getActiveMembership,
} = require("./santriUnitService");

const TEMPLATE_HEADERS = [
  "nama",
  "nis",
  "jenis_kelamin",
  "tanggal_lahir",
  "tanggal_masuk_pesantren",
  "alamat",
  "nama_wali",
  "no_hp_wali",
  "kelas",
  "kamar",
  "status",
];

const IGNORED_COLUMNS = new Set(["tenant_id"]);

function normalizeHeaderKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function cellToString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function parseDateValue(value, fieldName = "tanggal_lahir") {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { ok: true, value: value.toISOString().slice(0, 10) };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return { ok: true, value: d.toISOString().slice(0, 10) };
    }
  }

  const text = String(value).trim();
  if (!text) {
    return { ok: true, value: null };
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return { ok: true, value: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}` };
  }

  const dmyMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, "0");
    const mm = dmyMatch[2].padStart(2, "0");
    return { ok: true, value: `${dmyMatch[3]}-${mm}-${dd}` };
  }

  return { ok: false, error: `Format ${fieldName} tidak valid (gunakan YYYY-MM-DD)` };
}

function normalizeJenisKelamin(value) {
  const raw = cellToString(value).toUpperCase();
  if (!raw) return { ok: false, error: "jenis_kelamin wajib diisi (L atau P)" };
  if (raw === "L" || raw === "LAKI-LAKI" || raw === "LAKI LAKI") {
    return { ok: true, value: "L" };
  }
  if (raw === "P" || raw === "PEREMPUAN") {
    return { ok: true, value: "P" };
  }
  return { ok: false, error: "jenis_kelamin harus L atau P" };
}

function normalizeStatus(value) {
  const raw = cellToString(value).toLowerCase();
  if (!raw) return "aktif";
  if (["aktif", "active"].includes(raw)) return "aktif";
  if (["nonaktif", "inactive", "tidak aktif"].includes(raw)) return "nonaktif";
  return null;
}

function mapRawRow(raw) {
  const mapped = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeHeaderKey(key);
    if (IGNORED_COLUMNS.has(normalized)) continue;
    mapped[normalized] = value;
  }
  return mapped;
}

function buildTemplateWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    [
      "Ahmad Fauzi",
      "2026001",
      "L",
      "2012-05-15",
      "2026-07-01",
      "Jl. Pesantren No. 1",
      "Bapak Fauzi",
      "081234567890",
      "Kelas 1A",
      "A-12",
      "aktif",
    ],
  ]);
  ws["!cols"] = TEMPLATE_HEADERS.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template Santri");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function parseWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("File Excel kosong");
  }
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

async function loadKelasMap(tenantId, unitId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, unit_id, nama_kelas FROM kelas WHERE tenant_id = $1 AND unit_id = $2`,
    [tenantId, unitId]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.nama_kelas).trim().toLowerCase(), row);
  }
  return map;
}

async function loadExistingIdentityMap(tenantId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, nis, uid_rfid, nama, status
     FROM santri
     WHERE tenant_id = $1 AND nis IS NOT NULL AND TRIM(nis) <> ''`,
    [tenantId]
  );
  const byNis = new Map();
  for (const row of rows) {
    const nis = cellToString(row.nis);
    if (!nis) continue;
    const list = byNis.get(nis) || [];
    list.push(row);
    byNis.set(nis, list);
  }
  return { byNis };
}

function validateRow(mapped, context) {
  const errors = [];
  const nama = cellToString(mapped.nama);
  const nis = cellToString(mapped.nis);
  const kelasName = cellToString(mapped.kelas);
  const namaWali = cellToString(mapped.nama_wali);
  const noHpWali = cellToString(mapped.no_hp_wali);
  const alamat = cellToString(mapped.alamat);
  const kamar = cellToString(mapped.kamar);

  if (!nama) {
    errors.push("nama wajib diisi");
  }

  const jk = normalizeJenisKelamin(mapped.jenis_kelamin);
  if (!jk.ok) {
    errors.push(jk.error);
  }

  const dateParsed = parseDateValue(mapped.tanggal_lahir, "tanggal_lahir");
  if (!dateParsed.ok) {
    errors.push(dateParsed.error);
  }

  const masukParsed = parseDateValue(
    mapped.tanggal_masuk_pesantren || mapped.tanggal_masuk,
    "tanggal_masuk_pesantren"
  );
  if (!masukParsed.ok) {
    errors.push(masukParsed.error);
  }

  if (!kelasName) {
    errors.push("kelas wajib diisi");
  }

  let kelasId = null;
  let invalidClass = false;
  if (kelasName) {
    const kelasRow = context.kelasMap.get(kelasName.toLowerCase());
    if (!kelasRow) {
      errors.push("kelas tidak ditemukan");
      invalidClass = true;
    } else {
      kelasId = kelasRow.id;
    }
  }

  const status = normalizeStatus(mapped.status);
  if (status === null) {
    errors.push("status tidak valid (gunakan aktif atau nonaktif)");
  }

  let normalizedHp = null;
  if (noHpWali) {
    normalizedHp = waliAppService.normalizePhone(noHpWali);
    if (!normalizedHp) {
      errors.push("no_hp_wali tidak valid");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, invalidClass };
  }

  return {
    ok: true,
    data: {
      nama,
      nis: nis || null,
      jenis_kelamin: jk.value,
      tanggal_lahir: dateParsed.value,
      tanggal_masuk_pesantren: masukParsed.value,
      alamat: alamat || null,
      kamar: kamar || null,
      nama_wali: namaWali || null,
      no_hp_wali: normalizedHp,
      kelas: kelasName,
      kelas_id: kelasId,
      status: status || "aktif",
    },
  };
}

function emptySummary() {
  return {
    NEW_SANTRI: 0,
    ATTACH_EXISTING: 0,
    ALREADY_IN_UNIT: 0,
    CONFLICT: 0,
    INVALID_CLASS: 0,
  };
}

function rowStatusFromAction(action) {
  return action === "CONFLICT" || action === "INVALID_CLASS" ? "invalid" : "valid";
}

async function classifyValidatedRow(tenantId, data, context, client = pool) {
  const nis = cellToString(data.nis);

  if (nis && context.fileNis.has(nis)) {
    return {
      action: "CONFLICT",
      status: "invalid",
      errors: ["nis duplikat dalam file"],
    };
  }

  const candidates = nis ? (context.identities.byNis.get(nis) || []) : [];
  if (candidates.length > 1) {
    return {
      action: "CONFLICT",
      status: "invalid",
      errors: ["identitas existing ambigu untuk NIS ini"],
    };
  }

  if (candidates.length === 1) {
    const existing = candidates[0];
    const membership = await getActiveMembership(tenantId, existing.id, context.unitId, client);
    return {
      action: membership ? "ALREADY_IN_UNIT" : "ATTACH_EXISTING",
      status: "valid",
      existing_santri_id: existing.id,
      existing_name: existing.nama,
    };
  }

  return {
    action: "NEW_SANTRI",
    status: "valid",
  };
}

async function previewImport(tenantId, buffer, { unitId, client = pool } = {}) {
  if (!Number.isInteger(Number(unitId))) {
    throw Object.assign(new Error("Unit aktif wajib dipilih untuk import"), {
      status: 400,
      code: "UNIT_REQUIRED",
    });
  }
  const rawRows = parseWorkbookBuffer(buffer);
  const normalizedUnitId = Number(unitId);
  const kelasMap = await loadKelasMap(tenantId, normalizedUnitId, client);
  const identities = await loadExistingIdentityMap(tenantId, client);
  const fileNis = new Set();
  const summary = emptySummary();

  const rows = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2;
    const mapped = mapRawRow(rawRows[i]);

    const isEmpty = TEMPLATE_HEADERS.every((h) => !cellToString(mapped[h]));
    if (isEmpty) continue;

    const result = validateRow(mapped, { kelasMap });

    if (result.ok) {
      const classification = await classifyValidatedRow(tenantId, result.data, {
        kelasMap,
        identities,
        fileNis,
        unitId: normalizedUnitId,
      }, client);
      if (result.data.nis) {
        fileNis.add(result.data.nis);
      }
      summary[classification.action] += 1;
      rows.push({
        row_number: rowNumber,
        status: rowStatusFromAction(classification.action),
        action: classification.action,
        existing_santri_id: classification.existing_santri_id || null,
        existing_name: classification.existing_name || null,
        errors: classification.errors || [],
        data: result.data,
      });
    } else {
      const action = result.invalidClass ? "INVALID_CLASS" : "CONFLICT";
      summary[action] += 1;
      rows.push({
        row_number: rowNumber,
        status: "invalid",
        action,
        errors: result.errors,
        data: {
          nama: cellToString(mapped.nama) || null,
          nis: cellToString(mapped.nis) || null,
          kelas: cellToString(mapped.kelas) || null,
          kamar: cellToString(mapped.kamar) || null,
        },
      });
    }
  }

  const validRows = rows.filter((r) => r.status === "valid").length;
  const invalidRows = rows.filter((r) => r.status === "invalid").length;

  return {
    success: true,
    total_rows: rows.length,
    valid_rows: validRows,
    invalid_rows: invalidRows,
    summary,
    unit_id: normalizedUnitId,
    rows,
  };
}

async function validateCommitRow(tenantId, rowData, context) {
  const mapped = {
    nama: rowData.nama,
    nis: rowData.nis,
    jenis_kelamin: rowData.jenis_kelamin,
    tanggal_lahir: rowData.tanggal_lahir,
    tanggal_masuk_pesantren: rowData.tanggal_masuk_pesantren,
    alamat: rowData.alamat,
    kamar: rowData.kamar,
    nama_wali: rowData.nama_wali,
    no_hp_wali: rowData.no_hp_wali,
    kelas: rowData.kelas,
    status: rowData.status,
  };
  return validateRow(mapped, context);
}

async function commitImport(tenantId, inputRows, { unitId, client: externalClient = null } = {}) {
  if (!Number.isInteger(Number(unitId))) {
    throw Object.assign(new Error("Unit aktif wajib dipilih untuk import"), {
      status: 400,
      code: "UNIT_REQUIRED",
    });
  }
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    return {
      success: false,
      error: "Tidak ada baris untuk diimport",
    };
  }

  const normalizedUnitId = Number(unitId);
  const preflightClient = externalClient || pool;
  const kelasMap = await loadKelasMap(tenantId, normalizedUnitId, preflightClient);
  const identities = await loadExistingIdentityMap(tenantId, preflightClient);
  const fileNis = new Set();
  const summary = emptySummary();

  const validated = [];
  const skipped = [];

  for (const item of inputRows) {
    const rowNumber = item.row_number;
    const rowData = item.data;
    if (!rowData) {
      skipped.push({ row_number: rowNumber, errors: ["Data baris tidak valid"] });
      continue;
    }

    const result = await validateCommitRow(tenantId, rowData, {
      kelasMap,
    });

    if (!result.ok) {
      const action = result.invalidClass ? "INVALID_CLASS" : "CONFLICT";
      summary[action] += 1;
      skipped.push({ row_number: rowNumber, action, errors: result.errors });
      continue;
    }

    const classification = await classifyValidatedRow(tenantId, result.data, {
      kelasMap,
      identities,
      fileNis,
      unitId: normalizedUnitId,
    }, preflightClient);
    if (result.data.nis) {
      fileNis.add(result.data.nis);
    }
    summary[classification.action] += 1;
    if (classification.status === "invalid") {
      skipped.push({
        row_number: rowNumber,
        action: classification.action,
        errors: classification.errors,
      });
      continue;
    }
    validated.push({
      row_number: rowNumber,
      data: result.data,
      action: classification.action,
      existing_santri_id: classification.existing_santri_id || null,
    });
  }

  if (validated.length === 0) {
    return {
      success: true,
      imported: 0,
      failed: skipped.length,
      summary,
      skipped,
      imported_rows: [],
    };
  }

  const client = externalClient || await pool.connect();
  const importedRows = [];

  try {
    if (!externalClient) await client.query("BEGIN");

    for (const { row_number, data, action, existing_santri_id } of validated) {
      let santri;
      let membership = null;

      if (action === "ALREADY_IN_UNIT") {
        const existing = await client.query(
          `SELECT id, nis, nama FROM santri WHERE tenant_id = $1 AND id = $2`,
          [tenantId, existing_santri_id],
        );
        santri = existing.rows[0];
      } else if (action === "ATTACH_EXISTING") {
        const existing = await client.query(
          `SELECT * FROM santri WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [tenantId, existing_santri_id],
        );
        santri = existing.rows[0];
        const primaryCheck = await client.query(
          `SELECT 1 FROM santri_units
           WHERE tenant_id = $1 AND santri_id = $2
             AND status = 'active' AND left_at IS NULL AND is_primary = true`,
          [tenantId, santri.id],
        );
        membership = await createMembershipWithEnrollment({
          tenant_id: tenantId,
          santri_id: santri.id,
          unit_id: normalizedUnitId,
          unit_student_number: data.nis || santri.nis || null,
          joined_at: data.tanggal_masuk_pesantren || null,
          is_primary: primaryCheck.rows.length === 0,
          kelas_id: data.kelas_id,
        }, client);
      } else {
        const insertResult = await client.query(
          `INSERT INTO santri (
             nis, nama, alamat, kelas_id, kamar, status, tenant_id,
             jenis_kelamin, tanggal_lahir, tanggal_masuk_pesantren, orang_tua, nomor_hp_ortu
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            data.nis,
            data.nama,
            data.alamat,
            data.kelas_id,
            data.kamar,
            data.status,
            tenantId,
            data.jenis_kelamin,
            data.tanggal_lahir,
            data.tanggal_masuk_pesantren,
            data.nama_wali,
            data.no_hp_wali,
          ]
        );

        santri = insertResult.rows[0];
        membership = await createMembershipWithEnrollment({
          tenant_id: tenantId,
          santri_id: santri.id,
          unit_id: normalizedUnitId,
          unit_student_number: data.nis || null,
          joined_at: data.tanggal_masuk_pesantren || null,
          is_primary: true,
          kelas_id: data.kelas_id,
        }, client);

        await syncWaliFromSantri(client, {
          tenantId,
          santri: {
            ...santri,
            nama_wali: data.nama_wali,
            no_hp_wali: data.no_hp_wali,
          },
        });
      }

      importedRows.push({
        row_number,
        action,
        santri_id: santri.id,
        nis: santri.nis,
        nama: santri.nama,
        membership_id: membership?.id || null,
      });
    }

    if (!externalClient) await client.query("COMMIT");

    return {
      success: true,
      imported: importedRows.length,
      failed: skipped.length,
      summary,
      skipped,
      imported_rows: importedRows,
    };
  } catch (err) {
    if (!externalClient) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (!externalClient) client.release();
  }
}

module.exports = {
  TEMPLATE_HEADERS,
  buildTemplateWorkbook,
  previewImport,
  commitImport,
  parseWorkbookBuffer,
};
