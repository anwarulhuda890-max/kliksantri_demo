import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import Button, { actionBarStyle } from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { Table, TableScroll } from "../components/ui/table";
import { OperationalPageStyles } from "../components/shared/OperationalPageStyles";
import { exportExcel } from "../utils/exportExcel";
import { FaFilter } from "react-icons/fa";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";
import { MONTH_OPTIONS_ID } from "../constants/monthOptions";

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
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .akademik-filter-panel.filter-bar-v3 {
        margin-bottom: 0;
      }

      .akademik-filter-panel .filter-bar-v3__fields select,
      .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
        min-width: 0;
        flex: 1 1 140px;
        max-width: 100%;
      }

      @media (max-width: 767px) {
        .akademik-filter-panel .filter-bar-v3__fields select,
        .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
          flex: 1 1 100%;
        }
      }
    `}</style>
  );
}

function NilaiPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const scopeParams = buildUnitScopeParams({ activeUnitId, allUnitsAllowed });
  const [kelas, setKelas] = useState([]);
  const [kelasId, setKelasId] = useState("");
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [santri, setSantri] = useState([]);
  const [santriLoading, setSantriLoading] = useState(false);
  const [santriError, setSantriError] = useState("");
  const studentRequestId = useRef(0);
  const [nilai, setNilai] = useState({});
  const [mapelList, setMapelList] = useState([]);

  const getNilai = async (b, t) => {
    try {
      const response = await api.get("/nilai", { params: { ...scopeParams, bulan: b, tahun: t } });
      const data = {};

      response.data.data.forEach((n) => {
        const key = `${n.santri_id}-${n.mapel}-${n.bulan}-${n.tahun}`;
        data[key] = n.nilai;
      });

      setNilai(data);
    } catch (err) {
      console.error(err);
    }
  };

  const getMapel = async (id) => {
    if (!id) {
      setMapelList([]);
      return;
    }
    try {
      const response = await api.get("/mata-pelajaran", { params: { ...scopeParams, kelas_id: id } });
      const assigned = (response.data.data || []).filter((item) => item.ditugaskan).map((item) => item.nama);
      setMapelList(assigned);
    } catch (err) {
      console.error(err);
      setMapelList([]);
    }
  };

  const getKelas = async () => {
    try {
      const response = await api.get("/kelas", { params: scopeParams });
      setKelas(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const getSantri = async (id) => {
    const requestId = ++studentRequestId.current;
    setSantri([]);
    setSantriError("");
    if (!id) {
      setSantriLoading(false);
      return;
    }

    try {
      setSantriLoading(true);
      const response = await api.get("/nilai/students", {
        params: { ...scopeParams, kelas_id: id },
      });
      if (studentRequestId.current === requestId) {
        setSantri(response.data.data || []);
      }
    } catch (err) {
      console.error(err);
      if (studentRequestId.current === requestId) {
        setSantriError(err.response?.data?.error || "Gagal memuat santri kelas");
      }
    } finally {
      if (studentRequestId.current === requestId) {
        setSantriLoading(false);
      }
    }
  };

  useEffect(() => {
    studentRequestId.current += 1;
    setKelasId("");
    setSantri([]);
    setSantriLoading(false);
    setSantriError("");
    setMapelList([]);
    getKelas();
  }, [activeUnitId, allUnitsAllowed]);

  useEffect(() => {
    getNilai(bulan, tahun);
  }, [bulan, tahun, activeUnitId, allUnitsAllowed]);

  const handleNilai = (santriId, mapel, value) => {
    const key = `${santriId}-${mapel}-${bulan}-${tahun}`;
    setNilai({
      ...nilai,
      [key]: value,
    });
  };

  const simpanNilai = async () => {
    const entries = Object.entries(nilai).filter(
      ([, val]) => val !== "" && val !== null && val !== undefined
    );

    if (entries.length === 0) {
      alert("Tidak ada nilai yang diisi.");
      return;
    }

    try {
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });
      for (const [key, nilaiVal] of entries) {
        const segments = key.split("-");
        const tahunKey = parseInt(segments[segments.length - 1], 10);
        const bulanKey = parseInt(segments[segments.length - 2], 10);
        const mapel = segments[segments.length - 3];
        const santriId = segments.slice(0, segments.length - 3).join("-");

        if (isNaN(tahunKey) || isNaN(bulanKey) || !mapel || !santriId) {
          console.warn("Skip key invalid:", key);
          continue;
        }

        await api.post("/nilai", {
          ...unitPayload,
          santri_id: santriId,
          tanggal: new Date().toISOString().split("T")[0],
          mapel,
          nilai: nilaiVal,
          bulan: bulanKey,
          tahun: tahunKey,
        });
      }

      alert(`Nilai berhasil disimpan (${entries.length} entri).`);
      getNilai(bulan, tahun);
    } catch (err) {
      console.error(err);
      alert("Gagal simpan: " + (err.response?.data?.error || err.message));
    }
  };

  const handleExport = () => {
    const rows = [];

    santri.forEach((s) => {
      mapelList.forEach((m) => {
        rows.push({
          Nama: s.nama,
          MataPelajaran: m,
          Nilai: nilai[`${s.id}-${m}-${bulan}-${tahun}`] || 0,
          Bulan: bulan,
          Tahun: tahun,
        });
      });
    });

    exportExcel(rows, "Nilai");
  };

  return (
    <AppShell title="Nilai Santri" breadcrumb="Akademik / Nilai Santri">
      <AkademikResponsiveStyles />
      <OperationalPageStyles />
      <div className="akademik-page ops-page">
      <div className="ops-page__form-card">
      <Card padding="md" shadow="card" border={false} radius="xl">
        <div className="akademik-filter-panel ops-page__filter filter-bar-v3 filter-bar-v3--table">
          <span className="filter-bar-v3__label">
            <FaFilter size={11} aria-hidden />
            Filter nilai
          </span>
          <div className="filter-bar-v3__fields" style={filterPanelStyle}>
          <select
            className="form-select-v3"
            value={kelasId}
            onChange={(e) => {
              setKelasId(e.target.value);
              getSantri(e.target.value);
              getMapel(e.target.value);
            }}
          >
            <option value="">Pilih Kelas</option>
            {kelas.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nama_kelas}
              </option>
            ))}
          </select>

          <select className="form-select-v3" value={bulan} onChange={(e) => setBulan(e.target.value)}>
            {MONTH_OPTIONS_ID.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <input
            className="form-control-v3"
            type="number"
            value={tahun}
            onChange={(e) => setTahun(e.target.value)}
            aria-label="Tahun"
          />
          </div>
        </div>
      </Card>
      </div>

      {!kelasId ? (
        <div className="ops-page__empty">
          <EmptyState
            title="Pilih kelas terlebih dahulu"
            description="Pilih kelas, bulan, dan tahun untuk mengisi nilai santri."
          />
        </div>
      ) : santriLoading ? (
        <div className="ops-page__empty">
          <EmptyState title="Memuat santri kelas" description="Menyiapkan daftar enrollment aktif..." />
        </div>
      ) : santriError ? (
        <div className="ops-page__empty">
          <EmptyState title="Gagal memuat santri kelas" description={santriError} />
        </div>
      ) : santri.length === 0 ? (
        <div className="ops-page__empty">
          <EmptyState
            title="Belum ada santri di kelas ini"
            description="Tidak ada enrollment santri aktif pada kelas yang dipilih."
          />
        </div>
      ) : (
      <div className="ops-akademik-card ops-page__card">
        <Card padding="md" shadow="card" border={false} radius="xl">
          <TableScroll matrix sticky>
          <Table>
            <thead>
              <tr>
                <th className="table-v3__col--sticky">Nama</th>
                {mapelList.map((m) => (
                  <th key={m}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {santri.map((s) => (
                <tr key={s.id}>
                  <td className="table-v3__col--sticky table-v3__cell--strong">{s.nama}</td>
                  {mapelList.map((m) => (
                    <td key={m} style={{ textAlign: "center" }}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="ops-nilai-input"
                        value={nilai[`${s.id}-${m}-${bulan}-${tahun}`] || ""}
                        onChange={(e) => handleNilai(s.id, m, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          </TableScroll>

          <div style={{ ...actionBarStyle, marginTop: "var(--space-4)" }}>
            <Button variant="success" onClick={handleExport}>
              Export Excel
            </Button>
            <Button variant="primary" onClick={simpanNilai}>
              Simpan Nilai
            </Button>
          </div>
        </Card>
      </div>
      )}
      </div>
    </AppShell>
  );
}

export default NilaiPage;
