const { readMigration, listMigrationFiles } = require("./migrationLedger");

const TYPE_MAP = new Map([
  ["serial", "int4"], ["integer", "int4"], ["int", "int4"],
  ["bigserial", "int8"], ["bigint", "int8"], ["smallint", "int2"],
  ["varchar", "varchar"], ["character varying", "varchar"],
  ["char", "bpchar"], ["text", "text"], ["boolean", "bool"],
  ["date", "date"], ["time", "time"], ["timestamp", "timestamp"],
  ["timestamptz", "timestamptz"], ["numeric", "numeric"],
  ["decimal", "numeric"], ["json", "json"], ["jsonb", "jsonb"],
]);

function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote && input[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function canonicalType(definition) {
  const match = definition.trim().match(
    /^(serial|bigserial|smallint|integer|int|bigint|character varying(?:\s*\(\d+\))?|varchar(?:\s*\(\d+\))?|char(?:\s*\(\d+\))?|text|boolean|date|timestamptz|timestamp(?:\s+(?:with|without)\s+time\s+zone)?|time(?:\s+(?:with|without)\s+time\s+zone)?|numeric(?:\s*\([^)]*\))?|decimal(?:\s*\([^)]*\))?|jsonb?|[a-z_][a-z0-9_]*\[\])/i,
  );
  if (!match) return null;
  let raw = match[1].toLowerCase().replace(/\s*\([^)]*\)/g, "");
  if (raw.endsWith("[]")) return `_${raw.slice(0, -2)}`;
  if (raw === "timestamp with time zone") raw = "timestamptz";
  if (raw === "timestamp without time zone") raw = "timestamp";
  if (raw === "time with time zone") raw = "timetz";
  if (raw === "time without time zone") raw = "time";
  return TYPE_MAP.get(raw) || raw;
}

function addColumn(expectations, table, name, definition) {
  if (!name || /^(constraint|primary|unique|foreign|check)$/i.test(name)) return;
  const defaultMatch = definition.match(
    /\bDEFAULT\s+([\s\S]+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT)\b|$)/i,
  );
  expectations.columns.push({
    table: table.toLowerCase(),
    name: name.toLowerCase(),
    type: canonicalType(definition),
    notNull: /\bNOT\s+NULL\b/i.test(definition),
    hasDefault: /\bDEFAULT\b/i.test(definition) || /^(serial|bigserial)\b/i.test(definition.trim()),
    defaultExpression: /^(serial|bigserial)\b/i.test(definition.trim())
      ? "__sequence__"
      : defaultMatch?.[1]?.trim() || null,
  });
}

function normalizeDefault(value) {
  let normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) normalized = normalized.slice(1, -1).trim();
  normalized = normalized.replace(/::(?:character varying|varchar|text|bpchar)\s*$/i, "");
  return normalized;
}

function defaultsEquivalent(expected, actual) {
  if (expected === "__sequence__") return /^nextval\(/i.test(String(actual || ""));
  const left = normalizeDefault(expected);
  const right = normalizeDefault(actual);
  if (["now()", "current_timestamp"].includes(left) && ["now()", "current_timestamp"].includes(right)) return true;
  return left === right;
}

function normalizeConstraintDefinition(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/\bpublic\./g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

function addSemanticConstraint(expectations, table, definition, name = null) {
  const normalized = normalizeConstraintDefinition(definition);
  if (!/^(primary key|unique|foreign key)\b/.test(normalized)) return;
  expectations.constraints.push({ table: table.toLowerCase(), name: name?.toLowerCase() || null, definition: normalized });
}

function extractExpectations(sql) {
  const clean = sql.replace(/--[^\r\n]*/g, " ");
  const expectations = {
    tables: [], columns: [], indexes: [], constraints: [], triggers: [],
    functions: [], enums: [], hasDml: /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(clean),
  };

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let match;
  while ((match = tableRegex.exec(clean))) {
    const table = match[1].toLowerCase();
    expectations.tables.push(table);
    let depth = 1;
    let cursor = tableRegex.lastIndex;
    while (cursor < clean.length && depth > 0) {
      if (clean[cursor] === "(") depth += 1;
      else if (clean[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    const body = clean.slice(tableRegex.lastIndex, cursor - 1);
    for (const part of splitTopLevel(body)) {
      const item = part.trim();
      const named = item.match(/^CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i);
      if (named) {
        expectations.constraints.push({ table, name: named[1].toLowerCase(), definition: normalizeConstraintDefinition(named[2]) });
        continue;
      }
      if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)\b/i.test(item)) {
        addSemanticConstraint(expectations, table, item);
        continue;
      }
      const column = item.match(/^"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i);
      if (column) {
        addColumn(expectations, table, column[1], column[2]);
        const definition = column[2];
        if (/\bPRIMARY\s+KEY\b/i.test(definition)) addSemanticConstraint(expectations, table, `PRIMARY KEY (${column[1]})`);
        if (/\bUNIQUE\b/i.test(definition)) addSemanticConstraint(expectations, table, `UNIQUE (${column[1]})`);
        const reference = definition.match(/\bREFERENCES\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([^)]+)\)([\s\S]*)/i);
        if (reference) {
          const actions = reference[3].match(/(?:ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\s*)+/i);
          addSemanticConstraint(expectations, table,
            `FOREIGN KEY (${column[1]}) REFERENCES ${reference[1]} (${reference[2]}) ${actions?.[0] || ""}`);
        }
      }
    }
    tableRegex.lastIndex = cursor;
  }

  const alterTableRegex = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+([^;]+);/gi;
  while ((match = alterTableRegex.exec(clean))) {
    const table = match[1];
    const actions = match[2];
    const addColumnRegex = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s+([\s\S]*?)(?=,\s*ADD\s+(?:COLUMN|CONSTRAINT)\b|$)/gi;
    let columnMatch;
    while ((columnMatch = addColumnRegex.exec(actions))) {
      addColumn(expectations, table, columnMatch[1], columnMatch[2]);
    }
    const addConstraintRegex = /ADD\s+CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?\s+([\s\S]*?)(?=,\s*(?:ADD|DROP|ALTER)\b|$)/gi;
    let constraintMatch;
    while ((constraintMatch = addConstraintRegex.exec(actions))) {
      expectations.constraints.push({
        table: table.toLowerCase(),
        name: constraintMatch[1].toLowerCase(),
        definition: normalizeConstraintDefinition(constraintMatch[2]),
      });
    }
  }

  const indexRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  while ((match = indexRegex.exec(clean))) expectations.indexes.push(match[1].toLowerCase());

  const triggerRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?([a-z_][a-z0-9_]*)"?/gi;
  while ((match = triggerRegex.exec(clean))) expectations.triggers.push(match[1].toLowerCase());

  const functionRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  while ((match = functionRegex.exec(clean))) expectations.functions.push(match[1].toLowerCase());

  const enumRegex = /CREATE\s+TYPE\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+AS\s+ENUM/gi;
  while ((match = enumRegex.exec(clean))) expectations.enums.push(match[1].toLowerCase());

  for (const key of ["tables", "indexes", "triggers", "functions", "enums"]) {
    expectations[key] = [...new Set(expectations[key])];
  }
  expectations.constraints = expectations.constraints.filter((item, index, all) =>
    all.findIndex((other) => other.table === item.table && other.name === item.name && other.definition === item.definition) === index,
  );
  expectations.columns = expectations.columns.filter((item, index, all) =>
    all.findIndex((other) => other.table === item.table && other.name === item.name) === index,
  );
  return expectations;
}

async function readCatalog(client) {
  const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  const columns = await client.query(`SELECT table_name,column_name,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public'`);
  const indexes = await client.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'`);
  const constraints = await client.query(`SELECT conname,conrelid::regclass::text table_name,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace='public'::regnamespace`);
  const triggers = await client.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`);
  const functions = await client.query(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace`);
  const enums = await client.query(`SELECT typname FROM pg_type WHERE typnamespace='public'::regnamespace AND typtype='e'`);
  return {
    tables: new Set(tables.rows.map((row) => row.table_name)),
    columns: new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row])),
    indexes: new Map(indexes.rows.map((row) => [row.indexname, row.indexdef])),
    constraints: constraints.rows.map((row) => ({
      name: row.conname,
      table: row.table_name.replace(/^public\./, ""),
      definition: normalizeConstraintDefinition(row.definition),
    })),
    triggers: new Set(triggers.rows.map((row) => row.tgname)),
    functions: new Set(functions.rows.map((row) => row.proname)),
    enums: new Set(enums.rows.map((row) => row.typname)),
  };
}

function evaluateMigration(migration, catalog) {
  const expected = extractExpectations(migration.sql);
  const evidence = [];
  let found = 0;
  let missing = 0;
  let drift = 0;

  function record(kind, name, exists, detail = null) {
    evidence.push({ kind, name, found: exists, ...(detail ? { detail } : {}) });
    if (exists) found += 1; else missing += 1;
  }

  for (const table of expected.tables) record("table", table, catalog.tables.has(table));
  for (const column of expected.columns) {
    const key = `${column.table}.${column.name}`;
    const actual = catalog.columns.get(key);
    if (!actual) { record("column", key, false); continue; }
    const differences = [];
    if (column.type && actual.udt_name !== column.type) differences.push(`type expected=${column.type} actual=${actual.udt_name}`);
    if (column.notNull && actual.is_nullable !== "NO") differences.push("expected NOT NULL");
    if (column.hasDefault && actual.column_default == null) differences.push("expected DEFAULT");
    else if (column.defaultExpression && !defaultsEquivalent(column.defaultExpression, actual.column_default)) {
      differences.push("DEFAULT expression differs");
    }
    record("column", key, true, differences.length ? differences.join("; ") : null);
    if (differences.length) drift += 1;
  }
  for (const name of expected.indexes) record("index", name, catalog.indexes.has(name));
  for (const constraint of expected.constraints) {
    const actual = catalog.constraints.find((item) =>
      item.table === constraint.table && (constraint.name
        ? item.name === constraint.name
        : item.definition === constraint.definition),
    );
    const label = constraint.name || `${constraint.table}:${constraint.definition}`;
    record("constraint", label, Boolean(actual));
  }
  for (const name of expected.triggers) record("trigger", name, catalog.triggers.has(name));
  for (const name of expected.functions) record("function", name, catalog.functions.has(name));
  for (const name of expected.enums) record("enum", name, catalog.enums.has(name));

  const verifiableCount = found + missing;
  let status;
  if (drift > 0) status = "DRIFTED";
  else if (verifiableCount === 0) status = "CANNOT_VERIFY";
  else if (found === 0) status = "NOT_APPLIED";
  else if (missing > 0) status = "PARTIALLY_APPLIED";
  else status = "VERIFIED_APPLIED";

  const notes = [];
  if (expected.hasDml) notes.push("Memuat DML/backfill; efek historis data tidak dapat dibuktikan hanya dari catalog schema.");
  if (verifiableCount === 0) notes.push("Tidak ditemukan efek schema persisten yang dapat diverifikasi otomatis.");
  return {
    filename: migration.filename,
    checksum: migration.checksum,
    status,
    evidence,
    notes,
    recommended_action: status === "VERIFIED_APPLIED"
      ? "Eligible untuk baseline setelah review evidence."
      : status === "NOT_APPLIED"
        ? "Jangan baseline; evaluasi untuk eksekusi terurut."
        : "Jangan baseline; lakukan review/manual remediation.",
  };
}

async function auditMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const catalog = await readCatalog(client);
    const results = listMigrationFiles().map((filename) =>
      evaluateMigration(readMigration(filename), catalog),
    );
    await client.query("ROLLBACK");
    return results;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  auditMigrations,
  canonicalType,
  evaluateMigration,
  defaultsEquivalent,
  extractExpectations,
  normalizeDefault,
  normalizeConstraintDefinition,
  readCatalog,
  splitTopLevel,
};
