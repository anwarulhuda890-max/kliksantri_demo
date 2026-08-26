const XLSX = require("xlsx");
const pool = require("../db");

const TEMPLATE_COLUMNS = [
  "Nama Lengkap",
  "NIS",
  "Jenis Kelamin",
  "Tahun Masuk",
  "Tahun Lulus",
  "Angkatan",
  "Status Kelulusan",
  "Kelas Terakhir",
  "Kontak",
  "Alamat",
  "Pekerjaan",
  "Catatan",
];

const HEADER_MAP = new Map([
  ["nama_lengkap", "nama"], ["nama", "nama"], ["nis", "nis"],
  ["jenis_kelamin", "jenis_kelamin"], ["tahun_masuk", "tahun_masuk"],
  ["tahun_lulus", "tahun_lulus"], ["angkatan", "angkatan"],
  ["status_kelulusan", "status_kelulusan"], ["status", "status_kelulusan"],
  ["kelas_terakhir", "kelas_terakhir"], ["kontak", "kontak"],
  ["nomor_hp_wali_kontak", "kontak"], ["nomor_hp_wali", "kontak"],
  ["alamat", "alamat"], ["pekerjaan", "pekerjaan"],
  ["catatan", "catatan"], ["keterangan", "catatan"],
]);

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeHeader(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeIdentifier(value) {
  return text(value).toLowerCase();
}

function normalizeName(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function parseYear(value, field, { required = false } = {}) {
  const raw = text(value);
  if (!raw) return required
    ? { ok: false, error: `${field} wajib diisi` }
    : { ok: true, value: null };
  if (!/^\d{4}$/.test(raw)) return { ok: false, error: `${field} harus 4 digit` };
  const year = Number(raw);
  if (year < 1900 || year > 2200) return { ok: false, error: `${field} harus antara 1900-2200` };
  return { ok: true, value: year };
}

function normalizeGender(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return { ok: true, value: null };
  if (["l", "laki-laki", "laki laki", "pria"].includes(raw)) return { ok: true, value: "Laki-laki" };
  if (["p", "perempuan", "wanita"].includes(raw)) return { ok: true, value: "Perempuan" };
  return { ok: false, error: "jenis kelamin harus Laki-laki/L atau Perempuan/P" };
}

function normalizeStatus(value) {
  const raw = text(value).toLowerCase() || "lulus";
  if (["lulus", "keluar"].includes(raw)) return { ok: true, value: raw };
  return { ok: false, error: "status kelulusan harus lulus atau keluar" };
}

function mapRawRow(raw) {
  const mapped = {};
  for (const [header, value] of Object.entries(raw || {})) {
    const key = HEADER_MAP.get(normalizeHeader(header));
    if (key) mapped[key] = value;
  }
  return mapped;
}

function validateRow(raw) {
  const errors = [];
  const nama = text(raw.nama);
  const nis = text(raw.nis);
  if (!nama) errors.push("nama lengkap wajib diisi");
  if (!nis) errors.push("NIS wajib diisi untuk import identity-safe");
  const masuk = parseYear(raw.tahun_masuk, "tahun masuk");
  const lulus = parseYear(raw.tahun_lulus, "tahun lulus", { required: true });
  const gender = normalizeGender(raw.jenis_kelamin);
  const status = normalizeStatus(raw.status_kelulusan);
  for (const result of [masuk, lulus, gender, status]) if (!result.ok) errors.push(result.error);
  if (masuk.ok && lulus.ok && masuk.value && lulus.value && lulus.value < masuk.value) {
    errors.push("tahun lulus tidak boleh sebelum tahun masuk");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      nama,
      nis,
      jenis_kelamin: gender.value,
      tahun_masuk: masuk.value,
      tahun_lulus: lulus.value,
      angkatan: text(raw.angkatan) || null,
      status_kelulusan: status.value,
      kelas_terakhir: text(raw.kelas_terakhir) || null,
      kontak: text(raw.kontak) || null,
      alamat: text(raw.alamat) || null,
      pekerjaan: text(raw.pekerjaan) || null,
      catatan: text(raw.catatan) || null,
    },
  };
}

function buildTemplateWorkbook() {
  const dataSheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_COLUMNS,
    ["Ahmad Fauzi", "2018001", "L", "2015", "2018", "2015", "lulus", "3 Aliyah", "081234567890", "Jl. Pesantren No. 1", "Wiraswasta", "Alumni lama"],
  ]);
  dataSheet["!cols"] = TEMPLATE_COLUMNS.map((name) => ({ wch: Math.max(16, name.length + 2) }));
  const helpSheet = XLSX.utils.aoa_to_sheet([
    ["PETUNJUK IMPORT ALUMNI"],
    ["Kolom wajib", "Nama Lengkap, NIS, Tahun Lulus"],
    ["Kolom opsional", "Jenis Kelamin, Tahun Masuk, Angkatan, Status Kelulusan, Kelas Terakhir, Kontak, Alamat, Pekerjaan, Catatan"],
    ["Format tahun", "YYYY, contoh 2018"],
    ["Jenis kelamin", "L/P atau Laki-laki/Perempuan"],
    ["Status kelulusan", "lulus atau keluar; default lulus"],
    ["Identity safety", "NIS dipakai untuk mencocokkan Santri existing. Nama yang berbeda untuk NIS sama menjadi CONFLICT."],
    ["Unit", "Unit tidak ditulis di file. Import selalu menggunakan unit aktif di aplikasi."],
  ]);
  helpSheet["!cols"] = [{ wch: 22 }, { wch: 95 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Data Alumni");
  XLSX.utils.book_append_sheet(workbook, helpSheet, "Petunjuk");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function parseWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw Object.assign(new Error("File Excel kosong"), { status: 400, code: "INVALID_FILE" });
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  if (rows.length > 2000) {
    throw Object.assign(new Error("Maksimal 2000 baris per file"), { status: 400, code: "IMPORT_ROW_LIMIT" });
  }
  return rows;
}

function emptySummary() {
  return { NEW_ALUMNI: 0, EXISTING_SANTRI: 0, EXISTING_ALUMNI: 0, ALREADY_ALUMNI: 0, CONFLICT: 0, INVALID: 0 };
}

async function classifyNormalizedRow(tenantId, unitId, data, client = pool) {
  const normalizedNis = normalizeIdentifier(data.nis);
  const santriResult = await client.query(
    `SELECT id, nama, nis FROM santri
     WHERE tenant_id = $1 AND LOWER(BTRIM(nis)) = $2 ORDER BY id`,
    [tenantId, normalizedNis],
  );
  if (santriResult.rows.length > 1) {
    return { action: "CONFLICT", status: "conflict", errors: ["NIS mengarah ke lebih dari satu identity Santri"] };
  }

  let alumni = null;
  let action = "NEW_ALUMNI";
  let identityKey = `NIS:${normalizedNis}`;
  if (santriResult.rows.length === 1) {
    const santri = santriResult.rows[0];
    if (normalizeName(santri.nama) !== normalizeName(data.nama)) {
      return { action: "CONFLICT", status: "conflict", errors: ["Nama tidak cocok dengan identity Santri untuk NIS ini"] };
    }
    const result = await client.query(
      `SELECT * FROM alumni WHERE tenant_id = $1 AND santri_id = $2 LIMIT 1`,
      [tenantId, santri.id],
    );
    alumni = result.rows[0] || null;
    action = "EXISTING_SANTRI";
    identityKey = `SANTRI:${santri.id}`;
    if (!alumni) {
      const manual = await client.query(
        `SELECT * FROM alumni
         WHERE tenant_id=$1 AND santri_id IS NULL AND nis IS NOT NULL
           AND LOWER(BTRIM(nis))=$2 ORDER BY id`,
        [tenantId, normalizedNis],
      );
      if (manual.rows.length > 1) {
        return { action: "CONFLICT", status: "conflict", errors: ["NIS mengarah ke lebih dari satu snapshot Alumni manual"] };
      }
      alumni = manual.rows[0] || null;
      if (alumni && normalizeName(alumni.nama) !== normalizeName(data.nama)) {
        return { action: "CONFLICT", status: "conflict", errors: ["Nama Santri tidak cocok dengan Alumni manual untuk NIS ini"] };
      }
      if (!alumni) return { action, status: "valid", santri_id: santri.id, identity_key: identityKey };
    }
  } else {
    const result = await client.query(
      `SELECT * FROM alumni
       WHERE tenant_id = $1 AND nis IS NOT NULL AND LOWER(BTRIM(nis)) = $2
       ORDER BY id`,
      [tenantId, normalizedNis],
    );
    if (result.rows.length > 1) {
      return { action: "CONFLICT", status: "conflict", errors: ["NIS mengarah ke lebih dari satu snapshot Alumni"] };
    }
    alumni = result.rows[0] || null;
    if (alumni && normalizeName(alumni.nama) !== normalizeName(data.nama)) {
      return { action: "CONFLICT", status: "conflict", errors: ["Nama tidak cocok dengan Alumni existing untuk NIS ini"] };
    }
    if (alumni) action = alumni.santri_id ? "EXISTING_SANTRI" : "EXISTING_ALUMNI";
  }

  if (alumni) {
    const owned = await client.query(
      `SELECT id FROM alumni_units
       WHERE tenant_id = $1 AND alumni_id = $2 AND unit_id = $3
         AND COALESCE(tahun_lulus, 0) = COALESCE($4::integer, 0)
       LIMIT 1`,
      [tenantId, alumni.id, unitId, data.tahun_lulus],
    );
    if (owned.rows.length) {
      if (action === "EXISTING_SANTRI" && !alumni.santri_id) {
        return {
          action,
          status: "valid",
          alumni_id: alumni.id,
          santri_id: santriResult.rows[0]?.id || null,
          identity_key: identityKey,
          reconciliation_only: true,
        };
      }
      return { action: "ALREADY_ALUMNI", status: "existing", alumni_id: alumni.id, identity_key: identityKey };
    }
  }
  return {
    action,
    status: "valid",
    alumni_id: alumni?.id || null,
    santri_id: santriResult.rows[0]?.id || alumni?.santri_id || null,
    identity_key: identityKey,
  };
}

async function previewImport(tenantId, unitId, buffer, client = pool) {
  const rawRows = parseWorkbookBuffer(buffer);
  const summary = emptySummary();
  const fileKeys = new Set();
  const rows = [];
  for (let index = 0; index < rawRows.length; index += 1) {
    const rowNumber = index + 2;
    const mapped = mapRawRow(rawRows[index]);
    if (!Object.values(mapped).some((value) => text(value))) continue;
    const validated = validateRow(mapped);
    if (!validated.ok) {
      summary.INVALID += 1;
      rows.push({ row_number: rowNumber, action: "INVALID", status: "invalid", errors: validated.errors, data: mapped });
      continue;
    }
    const fileKey = `${normalizeIdentifier(validated.data.nis)}:${validated.data.tahun_lulus}`;
    if (fileKeys.has(fileKey)) {
      summary.CONFLICT += 1;
      rows.push({ row_number: rowNumber, action: "CONFLICT", status: "conflict", errors: ["NIS dan tahun lulus duplikat dalam file"], data: validated.data });
      continue;
    }
    fileKeys.add(fileKey);
    const classification = await classifyNormalizedRow(tenantId, unitId, validated.data, client);
    summary[classification.action] += 1;
    rows.push({ row_number: rowNumber, ...classification, errors: classification.errors || [], data: validated.data });
  }
  return {
    total_rows: rows.length,
    valid_rows: rows.filter((row) => row.status === "valid").length,
    existing_rows: rows.filter((row) => ["EXISTING_SANTRI", "EXISTING_ALUMNI", "ALREADY_ALUMNI"].includes(row.action)).length,
    invalid_rows: rows.filter((row) => row.status === "invalid").length,
    conflict_rows: rows.filter((row) => row.status === "conflict").length,
    summary,
    rows,
  };
}

async function upsertAlumniIdentity(client, tenantId, data, classification) {
  if (classification.action === "EXISTING_SANTRI") {
    if (classification.alumni_id) {
      const linked = await client.query(
        `UPDATE alumni SET santri_id=$1, nama=$2, nis=$3,
           jenis_kelamin=COALESCE($4,jenis_kelamin), kontak=COALESCE($5,kontak),
           alamat=COALESCE($6,alamat), pekerjaan=COALESCE($7,pekerjaan),
           updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$8 AND id=$9 AND (santri_id IS NULL OR santri_id=$1)
         RETURNING *`,
        [classification.santri_id, data.nama, data.nis, data.jenis_kelamin,
          data.kontak, data.alamat, data.pekerjaan, tenantId, classification.alumni_id],
      );
      if (linked.rows[0]) return linked.rows[0];
    }
    const result = await client.query(
      `INSERT INTO alumni (
         tenant_id, santri_id, nama, nis, jenis_kelamin, tahun_masuk, tahun_lulus,
         angkatan, status_kelulusan, kelas_terakhir, kontak, alamat, pekerjaan, catatan
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tenant_id, santri_id) DO UPDATE SET
         nama = EXCLUDED.nama, nis = COALESCE(EXCLUDED.nis, alumni.nis),
         jenis_kelamin = COALESCE(EXCLUDED.jenis_kelamin, alumni.jenis_kelamin),
         kontak = COALESCE(EXCLUDED.kontak, alumni.kontak),
         alamat = COALESCE(EXCLUDED.alamat, alumni.alamat),
         pekerjaan = COALESCE(EXCLUDED.pekerjaan, alumni.pekerjaan),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [tenantId, classification.santri_id, data.nama, data.nis, data.jenis_kelamin,
        data.tahun_masuk, data.tahun_lulus, data.angkatan, data.status_kelulusan,
        data.kelas_terakhir, data.kontak, data.alamat, data.pekerjaan, data.catatan],
    );
    return result.rows[0];
  }
  if (classification.alumni_id) {
    const result = await client.query(
      `UPDATE alumni SET nama=$1, nis=$2, jenis_kelamin=COALESCE($3,jenis_kelamin),
         kontak=COALESCE($4,kontak), alamat=COALESCE($5,alamat),
         pekerjaan=COALESCE($6,pekerjaan), updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$7 AND id=$8 RETURNING *`,
      [data.nama, data.nis, data.jenis_kelamin, data.kontak, data.alamat, data.pekerjaan, tenantId, classification.alumni_id],
    );
    return result.rows[0];
  }
  const result = await client.query(
    `INSERT INTO alumni (
       tenant_id, nama, nis, jenis_kelamin, tahun_masuk, tahun_lulus, angkatan,
       status_kelulusan, kelas_terakhir, kontak, alamat, pekerjaan, catatan
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [tenantId, data.nama, data.nis, data.jenis_kelamin, data.tahun_masuk, data.tahun_lulus,
      data.angkatan, data.status_kelulusan, data.kelas_terakhir, data.kontak,
      data.alamat, data.pekerjaan, data.catatan],
  );
  return result.rows[0];
}

async function commitImport(tenantId, unitId, inputRows, externalClient = null) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    throw Object.assign(new Error("Tidak ada baris valid untuk diimport"), { status: 400, code: "EMPTY_IMPORT" });
  }
  const client = externalClient || await pool.connect();
  const summary = emptySummary();
  const importedRows = [];
  const skipped = [];
  const fileKeys = new Set();
  try {
    if (!externalClient) await client.query("BEGIN");
    for (const input of inputRows) {
      const validated = validateRow(input.data || {});
      if (!validated.ok) {
        summary.INVALID += 1;
        skipped.push({ row_number: input.row_number, action: "INVALID", errors: validated.errors });
        continue;
      }
      const data = validated.data;
      const fileKey = `${normalizeIdentifier(data.nis)}:${data.tahun_lulus}`;
      if (fileKeys.has(fileKey)) {
        summary.CONFLICT += 1;
        skipped.push({ row_number: input.row_number, action: "CONFLICT", errors: ["NIS dan tahun lulus duplikat dalam file"] });
        continue;
      }
      fileKeys.add(fileKey);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [`alumni:${tenantId}`, `${unitId}:${fileKey}`],
      );
      const classification = await classifyNormalizedRow(tenantId, unitId, data, client);
      summary[classification.action] += 1;
      if (classification.status !== "valid") {
        skipped.push({ row_number: input.row_number, action: classification.action, errors: classification.errors || [] });
        continue;
      }
      const alumni = await upsertAlumniIdentity(client, tenantId, data, classification);
      const relation = await client.query(
        `INSERT INTO alumni_units (
           tenant_id, alumni_id, unit_id, identity_key, tahun_masuk, tahun_lulus,
           angkatan, status_kelulusan, kelas_terakhir, catatan, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'excel_import')
         ON CONFLICT DO NOTHING RETURNING id`,
        [tenantId, alumni.id, unitId, classification.identity_key, data.tahun_masuk,
          data.tahun_lulus, data.angkatan, data.status_kelulusan, data.kelas_terakhir, data.catatan],
      );
      if (!relation.rowCount) {
        summary[classification.action] -= 1;
        summary.ALREADY_ALUMNI += 1;
        skipped.push({ row_number: input.row_number, action: "ALREADY_ALUMNI", errors: [] });
        continue;
      }
      importedRows.push({ row_number: input.row_number, action: classification.action, alumni_id: alumni.id, nama: alumni.nama, nis: alumni.nis });
    }
    if (!externalClient) await client.query("COMMIT");
    return { imported: importedRows.length, failed: skipped.length, summary, imported_rows: importedRows, skipped };
  } catch (error) {
    if (!externalClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (!externalClient) client.release();
  }
}

async function listScopedAlumni({ tenantId, unitId, search = "", tahunLulus = null, client = pool }) {
  const year = text(tahunLulus) ? Number(tahunLulus) : null;
  if (text(tahunLulus) && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
    throw Object.assign(new Error("Filter tahun lulus tidak valid"), { status: 400, code: "INVALID_YEAR_FILTER" });
  }
  const query = await client.query(
    `SELECT a.id, au.id AS alumni_unit_id, a.santri_id, a.nama, a.nis, a.jenis_kelamin,
            COALESCE(au.tahun_masuk, a.tahun_masuk) AS tahun_masuk,
            COALESCE(au.tahun_lulus, a.tahun_lulus) AS tahun_lulus,
            COALESCE(au.angkatan, a.angkatan) AS angkatan,
            au.status_kelulusan, COALESCE(au.kelas_terakhir, a.kelas_terakhir) AS kelas_terakhir,
            a.kontak, a.alamat, a.pekerjaan, COALESCE(au.catatan, a.catatan) AS catatan,
            u.id AS unit_id, u.nama AS unit_name
     FROM alumni_units au
     JOIN alumni a ON a.tenant_id = au.tenant_id AND a.id = au.alumni_id
     JOIN unit_pendidikan u ON u.tenant_id = au.tenant_id AND u.id = au.unit_id
     WHERE au.tenant_id = $1 AND au.unit_id = $2
       AND ($3 = '' OR CONCAT_WS(' ', a.nama, a.nis, a.kontak, a.alamat, a.pekerjaan,
             au.kelas_terakhir, au.angkatan, au.catatan) ILIKE '%' || $3 || '%')
       AND ($4::integer IS NULL OR COALESCE(au.tahun_lulus, a.tahun_lulus) = $4)
     ORDER BY COALESCE(au.tahun_lulus, a.tahun_lulus, 0) DESC, a.nama ASC, au.id ASC`,
    [tenantId, unitId, text(search), Number.isInteger(year) ? year : null],
  );
  const years = await client.query(
    `SELECT DISTINCT COALESCE(au.tahun_lulus, a.tahun_lulus) AS tahun_lulus
     FROM alumni_units au JOIN alumni a ON a.tenant_id=au.tenant_id AND a.id=au.alumni_id
     WHERE au.tenant_id=$1 AND au.unit_id=$2
       AND COALESCE(au.tahun_lulus, a.tahun_lulus) IS NOT NULL
     ORDER BY tahun_lulus DESC`,
    [tenantId, unitId],
  );
  return { rows: query.rows, years: years.rows.map((row) => Number(row.tahun_lulus)) };
}

function buildExportWorkbook(rows) {
  const exportRows = rows.map((row) => ({
    Nama: row.nama,
    NIS: row.nis || "",
    Unit: row.unit_name,
    "Jenis Kelamin": row.jenis_kelamin || "",
    "Tahun Masuk": row.tahun_masuk || "",
    "Tahun Lulus": row.tahun_lulus || "",
    Angkatan: row.angkatan || "",
    Status: row.status_kelulusan,
    "Kelas Terakhir": row.kelas_terakhir || "",
    Kontak: row.kontak || "",
    Alamat: row.alamat || "",
    Pekerjaan: row.pekerjaan || "",
    Keterangan: row.catatan || "",
  }));
  const sheet = XLSX.utils.json_to_sheet(exportRows);
  sheet["!cols"] = TEMPLATE_COLUMNS.map(() => ({ wch: 18 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Alumni");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

module.exports = {
  TEMPLATE_COLUMNS,
  buildExportWorkbook,
  buildTemplateWorkbook,
  classifyNormalizedRow,
  commitImport,
  listScopedAlumni,
  mapRawRow,
  parseWorkbookBuffer,
  previewImport,
  upsertAlumniIdentity,
  validateRow,
};
