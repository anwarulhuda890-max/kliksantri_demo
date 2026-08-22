import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import SectionHeading from "../components/ui/SectionHeading";
import StatusBadge from "../components/ui/StatusBadge";
import Button, { actionBarStyle } from "../components/ui/Button";
import { Table, TableScroll } from "../components/ui/table";
import { exportExcel } from "../utils/exportExcel";
import { hasPermission } from "../utils/hasPermission";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

const SESI_LIST = [
  "Ngaji Pagi",
  "Sekolah",
  "Ngaji Siang",
  "Ngaji Sore",
  "Ngaji Malam",
];

const filterPanelStyle = {
  display: "flex",
  gap: "var(--space-3)",
  flexWrap: "wrap",
  alignItems: "center",
};

function AkademikResponsiveStyles() {
  return (
    <style>{`
      .akademik-page {
        min-width: 0;
        max-width: 100%;
      }

      .akademik-filter-panel select,
      .akademik-filter-panel input[type="number"] {
        min-width: 0;
        flex: 1 1 140px;
        max-width: 100%;
      }

      @media (max-width: 767px) {
        .akademik-filter-panel select,
        .akademik-filter-panel input[type="number"] {
          flex: 1 1 100%;
        }
      }
    `}</style>
  );
}

function buildKey(sesi, santriId, bulan, tahun, hari) {
  return `${sesi}|${santriId}|${bulan}|${tahun}|${hari}`;
}

function parseKey(key) {
  const parts = key.split("|");
  if (parts.length !== 5) return null;
  const [sesi, santriId, bulan, tahun, hari] = parts;
  const b = parseInt(bulan, 10);
  const t = parseInt(tahun, 10);
  const h = parseInt(hari, 10);
  if (isNaN(b) || isNaN(t) || isNaN(h) || !santriId) return null;
  return { sesi, santriId, bulan: b, tahun: t, hari: h };
}

function absensiStatusLabel(status) {
  if (status === "H") return "Hadir";
  if (status === "I") return "Izin";
  if (status === "S") return "Sakit";
  if (status === "A") return "Alfa";
  return "";
}

function AbsensiPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const scopeParams = buildUnitScopeParams({ activeUnitId, allUnitsAllowed });
  const [kelas, setKelas] = useState([]);
  const [kelasId, setKelasId] = useState("");
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [santri, setSantri] = useState([]);
  const [absensi, setAbsensi] = useState({});
  const [error, setError] = useState("");

  const fetchSeqRef = useRef(0);
  const canManageAbsensi =
    hasPermission("absensi.manage") ||
    hasPermission("absensi.create") ||
    hasPermission("absensi.update");

  const getAbsensi = async (b, t) => {
    const seq = ++fetchSeqRef.current;
    try {
      const response = await api.get("/absensi", {
        params: { ...scopeParams, bulan: b, tahun: t },
      });

      if (seq !== fetchSeqRef.current) {
        
        return;
      }

      const data = {};
      response.data.data.forEach((a) => {
        if (!a.tanggal || !a.sesi) return;

        const dateStr = String(a.tanggal).slice(0, 10);
        const parts = dateStr.split("-");
        if (parts.length !== 3) return;

        const recTahun = parseInt(parts[0], 10);
        const recBulan = parseInt(parts[1], 10);
        const hari = parseInt(parts[2], 10);
        if (isNaN(recTahun) || isNaN(recBulan) || isNaN(hari)) return;
        
        data[buildKey(a.sesi, a.santri_id, recBulan, recTahun, hari)] = a.status;
      });

      
      setAbsensi(data);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Gagal memuat absensi");
    }
  };

  const getKelas = async () => {
    try {
      const response = await api.get("/absensi/kelas", { params: scopeParams });
      const list = response.data.data || [];
      setKelas(list);
      if (list.length === 1) {
        setKelasId(String(list[0].id));
        getSantri(list[0].id);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Gagal memuat kelas akses");
    }
  };

  const getSantri = async (id) => {
    if (!id) {
      setSantri([]);
      return;
    }

    try {
      const response = await api.get("/absensi/santri", {
        params: { ...scopeParams, kelas_id: id },
      });
      setSantri(response.data.data || []);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Gagal memuat santri kelas");
    }
  };

  useEffect(() => {
    setKelasId("");
    setSantri([]);
    getKelas();
  }, [activeUnitId, allUnitsAllowed]);

  useEffect(() => {
    getAbsensi(bulan, tahun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulan, tahun, activeUnitId, allUnitsAllowed]);

  const handleAbsensi = (sesi, santriId, hari, value) => {
    const key = buildKey(sesi, santriId, bulan, tahun, hari);
    setAbsensi((prev) => ({ ...prev, [key]: value }));
  };

  const simpanAbsensi = async () => {
    if (!canManageAbsensi) {
      setError("Role belum memiliki izin kelola absensi");
      return;
    }

    const entries = Object.entries(absensi).filter(
      ([, val]) => val && val !== ""
    );

    if (entries.length === 0) {
      alert("Tidak ada data absensi yang diisi.");
      return;
    }

    try {
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });
      for (const [key, status] of entries) {
        const parsed = parseKey(key);
        if (!parsed) continue;

        const { sesi, santriId, bulan: bKey, tahun: tKey, hari } = parsed;
        const tanggal = `${tKey}-${String(bKey).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;

        await api.post("/absensi", {
          ...unitPayload,
          santri_id: santriId,
          tanggal,
          sesi,
          status,
        });
      }

      
      alert(`Absensi berhasil disimpan (${entries.length} entri).`);
      
      
      await getAbsensi(bulan, tahun);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Gagal simpan absensi");
    }
  };

  const totalHari = new Date(tahun, bulan, 0).getDate();

  const handleExport = () => {
    const rows = [];
    santri.forEach((s) => {
      SESI_LIST.forEach((sesi) => {
        for (let hari = 1; hari <= totalHari; hari++) {
          rows.push({
            Nama: s.nama,
            Kamar: s.kamar,
            Sesi: sesi,
            Tanggal: `${hari}/${bulan}/${tahun}`,
            Status: absensi[buildKey(sesi, s.id, bulan, tahun, hari)] || "-",
          });
        }
      });
    });
    exportExcel(rows, "Absensi");
  };

  return (
    <AppShell title="Absensi Bulanan" breadcrumb="Akademik / Absensi Bulanan">
      <AkademikResponsiveStyles />
      <div className="akademik-page">
      {error ? (
        <div style={errorBannerStyle}>{error}</div>
      ) : null}
      <Card padding="md" shadow="card" border={false} radius="xl">
        <div className="akademik-filter-panel ops-page__filter filter-bar-v3 filter-bar-v3--table">
          <span className="filter-bar-v3__label">Filter absensi</span>
          <div className="filter-bar-v3__fields" style={filterPanelStyle}>
          <select
            className="form-select-v3"
            value={kelasId}
            onChange={(e) => {
              setKelasId(e.target.value);
              getSantri(e.target.value);
            }}
            disabled={kelas.length === 1}
          >
            <option value="">Pilih Kelas</option>
            {kelas.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama_kelas}
              </option>
            ))}
          </select>

          <select
            className="form-select-v3"
            value={bulan}
            onChange={(e) => setBulan(Number(e.target.value))}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>
                Bulan {i + 1}
              </option>
            ))}
          </select>

          <input
            className="form-control-v3"
            type="number"
            value={tahun}
            onChange={(e) => setTahun(Number(e.target.value))}
          />
          </div>
        </div>
      </Card>

      {SESI_LIST.map((sesi) => (
        <div key={sesi} style={{ marginTop: "var(--space-6)" }}>
          <Card padding="md" shadow="card" border={false} radius="xl">
            <SectionHeading variant="eyebrow" spacing="first">
              {sesi}
            </SectionHeading>

            <div style={{ marginTop: "var(--space-4)" }}>
            <TableScroll matrix sticky>
              <Table>
              <thead>
                <tr>
                  <th className="table-v3__col--sticky">Nama / Kamar</th>
                  {Array.from({ length: totalHari }).map((_, i) => (
                    <th key={i}>{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {santri.map((s) => (
                  <tr key={s.id}>
                    <td className="table-v3__col--sticky table-v3__cell--strong">
                      <div>{s.nama}</div>
                      <small style={{ color: "var(--text-secondary)" }}>{s.kamar || "—"}</small>
                    </td>
                    {Array.from({ length: totalHari }).map((_, i) => {
                      const hari = i + 1;
                      const key = buildKey(sesi, s.id, bulan, tahun, hari);
                      const status = absensi[key] || "";

                      return (
                        <td key={hari} style={{ textAlign: "center" }}>
                          <select
                            value={status}
                            onChange={(e) =>
                              handleAbsensi(sesi, s.id, hari, e.target.value)
                            }
                            disabled={!canManageAbsensi}
                            style={{ border: "none", background: "transparent" }}
                          >
                            <option value="">-</option>
                            <option value="H">Hadir</option>
                            <option value="I">Izin</option>
                            <option value="S">Sakit</option>
                            <option value="A">Alfa</option>
                          </select>
                          {status && (
                            <div style={{ marginTop: "4px" }}>
                              <StatusBadge status={absensiStatusLabel(status) || status} size="sm" />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              </Table>
            </TableScroll>
            </div>
          </Card>
        </div>
      ))}

      <div style={{ ...actionBarStyle, marginTop: "var(--space-4)" }}>
        <Button variant="success" onClick={handleExport}>
          Export Excel
        </Button>
        {canManageAbsensi ? (
          <Button variant="primary" onClick={simpanAbsensi}>
            Simpan Semua Absensi
          </Button>
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}

const errorBannerStyle = {
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  padding: "12px 16px",
  borderRadius: "8px",
  marginBottom: "16px",
  fontSize: "14px",
  borderLeft: "3px solid var(--danger)",
};

export default AbsensiPage;
