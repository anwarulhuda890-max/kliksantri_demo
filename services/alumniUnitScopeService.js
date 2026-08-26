const pool = require("../db");
const { accessError, resolveActiveUnit } = require("./unitAccessService");

async function resolveAlumniUnit(req, client = pool) {
  const access = await resolveActiveUnit(req, client);
  if (access.mode !== "UNIT") {
    throw accessError("Pilih satu unit aktif untuk Alumni", 400, "UNIT_REQUIRED");
  }
  return access;
}

module.exports = { resolveAlumniUnit };
