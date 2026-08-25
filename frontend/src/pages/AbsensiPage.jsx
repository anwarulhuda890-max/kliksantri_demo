import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import SectionHeading from "../components/ui/SectionHeading";
import StatusBadge from "../components/ui/StatusBadge";
import Button, { actionBarStyle } from "../components/ui/Button";
import { Table, TableScroll } from "../components/ui/table";
import EmptyState from "../components/ui/EmptyState";
import { exportExcel } from "../utils/exportExcel";
import { hasPermission } from "../utils/hasPermission";
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

function buildKey(sessionId, santriId, bulan, tahun, hari) {
  return `${sessionId}|${santriId}|${bulan}|${tahun}|${hari}`;
}

function parseKey(key) {
  const parts = key.split("|");
  if (parts.length !== 5) return null;
  const [sessionId, santriId, bulan, tahun, hari] = parts;
  const parsedSessionId = parseInt(sessionId, 10);
  const b = parseInt(bulan, 10);
  const t = parseInt(tahun, 10);
  const h = parseInt(hari, 10);
  if (isNaN(parsedSessionId) || isNaN(b) || isNaN(t) || isNaN(h) || !santriId) return null;
  return { sessionId: parsedSessionId, santriId, bulan: b, tahun: t, hari: h };
}

function absensiStatusLabel(status) {
  if (status === "H") return "Hadir";
  if (status === "I") return "Izin";
  if (status === "S") return "Sakit";
  if (status === "A") return "Alfa";
  return "";
}

function AbsensiPage() {
  const { activeUnitId, activeUnit, allUnitsAllowed } = useActiveUnit();
  const scopeParams = buildUnitScopeParams({ activeUnitId, allUnitsAllowed });
  const [kelas, setKelas] = useState([]);
  const [kelasId, setKelasId] = useState("");
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [santri, setSantri] = useState([]);
  const [absensi, setAbsensi] = useState({});
  const [absensiLabels, setAbsensiLabels] = useState({});
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState([]);
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [newSession, setNewSession] = useState({
    display_name: "", start_time: "", end_time: "", sort_order: 10,
  });

  const fetchSeqRef = useRef(0);
  const canManageAbsensi =
    hasPermission("absensi.manage") ||
    hasPermission("absensi.create") ||
    hasPermission("absensi.update");

  const activeSessions = sessions.filter((session) => session.active);
  const attendanceSessionIds = new Set(
    Object.keys(absensi).map((key) => parseKey(key)?.sessionId).filter(Boolean),
  );
  const displaySessions = sessions.filter((session) => session.active || attendanceSessionIds.has(Number(session.id)));

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
      const labels = {};
      response.data.data.forEach((a) => {
        if (!a.tanggal || !a.session_id) return;

        const dateStr = String(a.tanggal).slice(0, 10);
        const parts = dateStr.split("-");
        if (parts.length !== 3) return;

        const recTahun = parseInt(parts[0], 10);
        const recBulan = parseInt(parts[1], 10);
        const hari = parseInt(parts[2], 10);
        if (isNaN(recTahun) || isNaN(recBulan) || isNaN(hari)) return;
        
        data[buildKey(a.session_id, a.santri_id, recBulan, recTahun, hari)] = a.status;
        labels[buildKey(a.session_id, a.santri_id, recBulan, recTahun, hari)] = a.sesi;
      });

      
      setAbsensi(data);
      setAbsensiLabels(labels);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Gagal memuat absensi");
    }
  };

  const getSessions = async () => {
    if (!activeUnitId) {
      setSessions([]);
      return;
    }
    try {
      const response = await api.get("/attendance-sessions", {
        params: {
          unit_id: activeUnitId,
          include_inactive: true,
        },
      });
      setSessions(response.data.data || []);
    } catch (err) {
      console.error(err);
      setSessions([]);
      setError(err.response?.data?.error || "Gagal memuat konfigurasi sesi absensi");
    }
  };

  const updateSessionDraft = (sessionId, field, value) => {
    setSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, [field]: value } : session
    )));
  };

  const createSession = async () => {
    if (!activeUnitId || !newSession.display_name.trim()) {
      setError("Pilih unit dan isi nama sesi terlebih dahulu");
      return;
    }
    setSessionSaving(true);
    setError("");
    try {
      await api.post("/attendance-sessions", {
        ...newSession,
        sort_order: Number(newSession.sort_order),
        unit_id: activeUnitId,
      });
      setNewSession({ display_name: "", start_time: "", end_time: "", sort_order: activeSessions.length * 10 + 10 });
      await getSessions();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menambah sesi absensi");
    } finally {
      setSessionSaving(false);
    }
  };

  const saveSession = async (session) => {
    if (!activeUnitId) return;
    setSessionSaving(true);
    setError("");
    try {
      await api.patch(`/attendance-sessions/${session.id}`, {
        display_name: session.display_name,
        start_time: session.start_time || null,
        end_time: session.end_time || null,
        sort_order: Number(session.sort_order),
        active: Boolean(session.active),
        unit_id: activeUnitId,
      });
      await getSessions();
      await getAbsensi(bulan, tahun);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan sesi absensi");
    } finally {
      setSessionSaving(false);
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

  // Resetting page state on workspace changes prevents stale cross-unit data.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError("");
    setKelas([]);
    setSantri([]);
    setSessions([]);
    setAbsensi({});
    setKelasId("");
    setAbsensiLabels({});
    getKelas();
    if (activeUnitId) getSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUnitId, allUnitsAllowed]);

  // Loading scoped attendance synchronizes the table with period/workspace changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    getAbsensi(bulan, tahun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulan, tahun, activeUnitId, allUnitsAllowed]);

  const handleAbsensi = (sessionId, santriId, hari, value) => {
    const key = buildKey(sessionId, santriId, bulan, tahun, hari);
    setAbsensi((prev) => ({ ...prev, [key]: value }));
    const currentLabel = sessions.find((session) => Number(session.id) === Number(sessionId))?.display_name;
    if (currentLabel) {
      setAbsensiLabels((prev) => ({ ...prev, [key]: currentLabel }));
    }
  };

  const simpanAbsensi = async () => {
    if (!canManageAbsensi) {
      setError("Role belum memiliki izin kelola absensi");
      return;
    }
    if (!activeUnitId) {
      setError("Pilih satu unit aktif sebelum menyimpan absensi");
      return;
    }

    const activeSessionIds = new Set(activeSessions.map((session) => Number(session.id)));
    const entries = Object.entries(absensi).filter(([key, value]) => {
      const parsed = parseKey(key);
      return value && value !== "" && parsed && activeSessionIds.has(parsed.sessionId);
    });

    if (entries.length === 0) {
      alert("Tidak ada data absensi yang diisi.");
      return;
    }

    try {
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });
      for (const [key, status] of entries) {
        const parsed = parseKey(key);
        if (!parsed) continue;

        const { sessionId, santriId, bulan: bKey, tahun: tKey, hari } = parsed;
        const tanggal = `${tKey}-${String(bKey).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;

        await api.post("/absensi", {
          ...unitPayload,
          santri_id: santriId,
          tanggal,
          session_id: sessionId,
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
      displaySessions.forEach((session) => {
        for (let hari = 1; hari <= totalHari; hari++) {
          rows.push({
            Nama: s.nama,
            Kamar: s.kamar,
            Sesi: session.display_name,
            Tanggal: `${hari}/${bulan}/${tahun}`,
            Status: absensi[buildKey(session.id, s.id, bulan, tahun, hari)] || "-",
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
      <p className="ops-page__meta">
        Workspace: {activeUnit?.nama || (allUnitsAllowed ? "Semua Unit" : "Unit belum dipilih")}
        {!activeUnitId && allUnitsAllowed ? " - pilih satu unit untuk mengisi absensi." : ""}
      </p>
      {error ? (
        <div style={errorBannerStyle}>{error}</div>
      ) : null}
      {canManageAbsensi && activeUnitId ? (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <Card padding="md" shadow="card" border={false} radius="xl">
            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "center" }}>
              <div>
                <SectionHeading variant="eyebrow" spacing="first">Sesi Absensi Unit</SectionHeading>
                <small style={{ color: "var(--text-secondary)" }}>
                  Nama, jam, urutan, dan status berlaku hanya untuk {activeUnit?.nama || "unit aktif"}.
                </small>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSessionSettingsOpen((open) => !open)}
              >
                {sessionSettingsOpen ? "Tutup Pengaturan" : "Atur Sesi"}
              </Button>
            </div>

            {sessionSettingsOpen ? (
              <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(180px, 2fr) repeat(3, minmax(90px, 1fr)) auto auto",
                      gap: "var(--space-2)",
                      alignItems: "end",
                      opacity: session.active ? 1 : 0.65,
                    }}
                  >
                    <label>
                      <small>Nama sesi</small>
                      <input
                        className="form-control-v3"
                        value={session.display_name}
                        onChange={(event) => updateSessionDraft(session.id, "display_name", event.target.value)}
                      />
                    </label>
                    <label>
                      <small>Mulai</small>
                      <input
                        className="form-control-v3"
                        type="time"
                        value={session.start_time || ""}
                        onChange={(event) => updateSessionDraft(session.id, "start_time", event.target.value)}
                      />
                    </label>
                    <label>
                      <small>Selesai</small>
                      <input
                        className="form-control-v3"
                        type="time"
                        value={session.end_time || ""}
                        onChange={(event) => updateSessionDraft(session.id, "end_time", event.target.value)}
                      />
                    </label>
                    <label>
                      <small>Urutan</small>
                      <input
                        className="form-control-v3"
                        type="number"
                        value={session.sort_order}
                        onChange={(event) => updateSessionDraft(session.id, "sort_order", event.target.value)}
                      />
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 38 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(session.active)}
                        onChange={(event) => updateSessionDraft(session.id, "active", event.target.checked)}
                      />
                      Aktif
                    </label>
                    <Button type="button" size="sm" onClick={() => saveSession(session)} disabled={sessionSaving}>
                      Simpan
                    </Button>
                  </div>
                ))}

                <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 2fr) repeat(3, minmax(90px, 1fr)) auto", gap: "var(--space-2)", alignItems: "end", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
                  <input className="form-control-v3" placeholder="Nama sesi baru" value={newSession.display_name} onChange={(event) => setNewSession({ ...newSession, display_name: event.target.value })} />
                  <input className="form-control-v3" aria-label="Jam mulai sesi baru" type="time" value={newSession.start_time} onChange={(event) => setNewSession({ ...newSession, start_time: event.target.value })} />
                  <input className="form-control-v3" aria-label="Jam selesai sesi baru" type="time" value={newSession.end_time} onChange={(event) => setNewSession({ ...newSession, end_time: event.target.value })} />
                  <input className="form-control-v3" aria-label="Urutan sesi baru" type="number" value={newSession.sort_order} onChange={(event) => setNewSession({ ...newSession, sort_order: event.target.value })} />
                  <Button type="button" size="sm" onClick={createSession} disabled={sessionSaving || !newSession.display_name.trim()}>
                    Tambah Sesi
                  </Button>
                </div>
                <small style={{ color: "var(--text-secondary)" }}>
                  Sesi yang pernah dipakai tidak dihapus; nonaktifkan agar histori tetap utuh.
                </small>
              </div>
            ) : null}
          </Card>
        </div>
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
            onChange={(e) => setTahun(Number(e.target.value))}
          />
          </div>
        </div>
      </Card>

      {!activeUnitId ? (
        <EmptyState
          title="Pilih satu unit"
          description="Sesi absensi dan pengisian kehadiran ditampilkan untuk satu unit aktif."
        />
      ) : displaySessions.length === 0 ? (
        <EmptyState
          title="Sesi absensi belum dikonfigurasi"
          description="Admin unit dapat membuka Atur Sesi untuk menambahkan jadwal absensi pertama."
        />
      ) : null}

      {displaySessions.map((session) => (
        <div key={session.id} style={{ marginTop: "var(--space-6)" }}>
          <Card padding="md" shadow="card" border={false} radius="xl">
            <SectionHeading variant="eyebrow" spacing="first">
              {session.display_name}
              {!session.active ? " (Nonaktif — histori)" : ""}
              {session.start_time || session.end_time ? (
                <small style={{ marginLeft: 8, color: "var(--text-secondary)" }}>
                  {session.start_time || "—"} - {session.end_time || "—"}
                </small>
              ) : null}
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
                      const key = buildKey(session.id, s.id, bulan, tahun, hari);
                      const status = absensi[key] || "";
                      const historicalLabel = absensiLabels[key];

                      return (
                        <td key={hari} style={{ textAlign: "center" }}>
                          <select
                            value={status}
                            onChange={(e) =>
                              handleAbsensi(session.id, s.id, hari, e.target.value)
                            }
                            disabled={!canManageAbsensi || !session.active}
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
                          {status && historicalLabel && historicalLabel !== session.display_name ? (
                            <small style={{ display: "block", marginTop: 4, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                              Dicatat: {historicalLabel}
                            </small>
                          ) : null}
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
