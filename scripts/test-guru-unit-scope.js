const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

const route = read("routes/guruRoutes.js");
const guruPage = read("frontend/src/pages/GuruPage.jsx");
const resolver = read("services/unitAccessService.js");

assert.match(route, /JOIN guru_units gu[\s\S]*gu\.status = 'active'/, "Guru list must use canonical active memberships");
assert.match(route, /AND gu\.unit_id = \$\$\{idx\}/, "Specific-unit list must filter in SQL");
assert.match(route, /scope: unitAccess\.mode === "UNIT" \? "unit" : "all"/, "Read endpoint must report resolved scope");
assert.match(route, /g\.nama ILIKE/, "Server search must remain tenant/unit scoped");
assert.equal((route.match(/unitAccess\.mode !== "UNIT"/g) || []).length, 3, "All Guru writes must fail closed without a unit");
assert.doesNotMatch(route, /DELETE FROM guru\b/, "Unit removal must never delete tenant identity");
assert.match(route, /SET status = 'left', left_at = NOW\(\), is_primary = false/, "Delete must soft-remove only the selected membership");
assert.match(route, /identity_retained: true/, "Delete response must make identity retention explicit");
assert.match(resolver, /if \(wantsAll\)[\s\S]*return \{ mode: "ALL"/, "scope=all must remain canonical read resolution");

assert.match(guruPage, /api\.get\("\/guru", \{[\s\S]*unit_id: activeUnitId[\s\S]*scope: "all"/, "Guru page must send selected unit or explicit aggregate scope");
assert.match(guruPage, /if \(!activeUnitId \|\| !form\.unit_id\)/, "Guru create/edit must require selected unit");
assert.match(guruPage, /api\.delete\(`\/guru\/\$\{g\.id\}`,[\s\S]*unit_id: activeUnitId/, "Guru delete must send selected unit");
assert.match(guruPage, /setGuru\(\[\]\)[\s\S]*\[activeUnitId, allUnitsAllowed\]/, "Workspace change must clear stale Guru rows");

const monthSource = read("frontend/src/constants/monthOptions.js");
const monthOptions = [...monthSource.matchAll(/\{ value: (\d+), label: "([^"]+)" \}/g)].map((match) => ({
  value: Number(match[1]),
  label: match[2],
}));
const expectedMonths = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
assert.deepEqual(monthOptions, expectedMonths.map((label, index) => ({ value: index + 1, label })));
assert.deepEqual([monthOptions[0], monthOptions[7], monthOptions[11]], [
  { value: 1, label: "Januari" },
  { value: 8, label: "Agustus" },
  { value: 12, label: "Desember" },
]);

for (const page of ["NilaiPage.jsx", "HafalanPage.jsx", "AbsensiPage.jsx", "AbsensiGuruPage.jsx"]) {
  const source = read(`frontend/src/pages/${page}`);
  assert.match(source, /MONTH_OPTIONS_ID/, `${page} must use shared Indonesian month options`);
  assert.match(source, /useState\(new Date\(\)\.getMonth\(\) \+ 1\)/, `${page} must preserve current-month default`);
  assert.doesNotMatch(source, /Bulan \{i \+ 1\}/, `${page} must not render numeric month labels`);
}

console.log("PASS Guru list is SQL-scoped by canonical guru_units membership");
console.log("PASS Guru writes require UNIT and cross-unit checks remain server-side");
console.log("PASS Guru delete removes membership and retains tenant identity");
console.log("PASS month UI contract Januari=1, Agustus=8, Desember=12");