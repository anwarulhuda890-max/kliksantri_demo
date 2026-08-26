import { useCallback, useRef, useState } from "react";
import Modal from "../Modal";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import { Table, TableScroll } from "../ui/table";
import api from "../../services/api";

function AlumniImportModal({ open, onClose, onImported, unitId, unitName }) {
  const inputRef = useRef(null);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setStep(1);
    setFile(null);
    setPreview(null);
    setResult(null);
    setLoading(false);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const close = () => {
    reset();
    onClose();
  };

  const chooseFile = (event) => {
    setFile(event.target.files?.[0] || null);
    setPreview(null);
    setResult(null);
    setError("");
    setStep(1);
  };

  const runPreview = async () => {
    if (!file) return setError("Pilih file Excel terlebih dahulu");
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setError("Format file harus .xlsx");
    setLoading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await api.post("/alumni/import/preview", body, {
        headers: { "Content-Type": "multipart/form-data" },
        params: { unit_id: unitId },
      });
      setPreview(response.data.data);
      setStep(2);
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Gagal preview file Alumni");
    } finally {
      setLoading(false);
    }
  };

  const runCommit = async () => {
    const validRows = preview?.rows?.filter((row) => row.status === "valid") || [];
    if (!validRows.length) return setError("Tidak ada baris valid untuk diimport");
    setLoading(true);
    setError("");
    try {
      const response = await api.post("/alumni/import/commit", {
        unit_id: unitId,
        rows: validRows,
      });
      setResult(response.data.data);
      setStep(3);
      if (response.data.data.imported > 0) onImported?.();
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Gagal import Alumni");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title="Import Alumni dari Excel" onClose={close} width={980}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Step active={step >= 1}>1. Pilih file</Step>
          <Step active={step >= 2}>2. Preview & validasi</Step>
          <Step active={step >= 3}>3. Commit</Step>
        </div>
        {error ? <div style={errorStyle}>{error}</div> : null}

        {step === 1 ? (
          <div>
            <p style={hintStyle}>
              Upload Excel (.xlsx, maksimum 5MB) untuk unit <strong>{unitName || "aktif"}</strong>.
              File belum akan disimpan sebelum preview dan konfirmasi commit.
            </p>
            <input ref={inputRef} style={{ maxWidth: "100%" }} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} />
            {file ? <p style={fileStyle}>File: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)</p> : null}
            <div style={actionsStyle}>
              <Button variant="primary" onClick={runPreview} disabled={!file || loading}>{loading ? "Memproses..." : "Preview Data"}</Button>
              <Button variant="secondary" onClick={close}>Batal</Button>
            </div>
          </div>
        ) : null}

        {step === 2 && preview ? (
          <div>
            <div style={summaryStyle}>
              <Summary label="Total baris" value={preview.total_rows} />
              <Summary label="Valid" value={preview.valid_rows} tone="success" />
              <Summary label="Existing" value={preview.existing_rows} />
              <Summary label="Invalid" value={preview.invalid_rows} tone="danger" />
              <Summary label="Conflict" value={preview.conflict_rows} tone="danger" />
            </div>
            <TableScroll stickyScrollbar>
              <Table>
                <thead><tr><th>Baris</th><th>Status</th><th>Klasifikasi</th><th>Nama</th><th>NIS</th><th>Tahun Lulus</th><th>Kelas</th><th>Catatan validasi</th></tr></thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row_number}>
                      <td>{row.row_number}</td>
                      <td><Badge variant={row.status === "valid" ? "success" : row.status === "existing" ? "warning" : "danger"}>{row.status}</Badge></td>
                      <td>{row.action}</td><td>{row.data?.nama || "—"}</td><td>{row.data?.nis || "—"}</td>
                      <td>{row.data?.tahun_lulus || "—"}</td><td>{row.data?.kelas_terakhir || "—"}</td>
                      <td style={{ color: row.errors?.length ? "var(--danger)" : "var(--text-secondary)", fontSize: 12 }}>{row.errors?.join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
            <div style={actionsStyle}>
              <Button variant="primary" onClick={runCommit} disabled={loading || preview.valid_rows === 0}>{loading ? "Mengimport..." : `Commit ${preview.valid_rows} Baris Valid`}</Button>
              <Button variant="secondary" onClick={() => setStep(1)} disabled={loading}>Pilih Ulang</Button>
              <Button variant="secondary" onClick={close} disabled={loading}>Tutup</Button>
            </div>
          </div>
        ) : null}

        {step === 3 && result ? (
          <div>
            <div style={summaryStyle}>
              <Summary label="Berhasil" value={result.imported} tone="success" />
              <Summary label="Dilewati" value={result.failed} tone={result.failed ? "danger" : undefined} />
              <Summary label="Alumni baru" value={result.summary?.NEW_ALUMNI || 0} />
              <Summary label="Santri existing" value={result.summary?.EXISTING_SANTRI || 0} />
              <Summary label="Sudah Alumni" value={result.summary?.ALREADY_ALUMNI || 0} />
            </div>
            {result.imported_rows?.length ? (
              <TableScroll><Table><thead><tr><th>Baris</th><th>Aksi</th><th>Nama</th><th>NIS</th></tr></thead><tbody>
                {result.imported_rows.map((row) => <tr key={`${row.row_number}-${row.alumni_id}`}><td>{row.row_number}</td><td>{row.action}</td><td>{row.nama}</td><td>{row.nis || "—"}</td></tr>)}
              </tbody></Table></TableScroll>
            ) : null}
            <div style={actionsStyle}><Button variant="primary" onClick={close}>Selesai</Button></div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Step({ active, children }) {
  return <span style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: active ? "var(--primary)" : "var(--surface-muted)", color: active ? "#fff" : "var(--text-secondary)" }}>{children}</span>;
}

function Summary({ label, value, tone }) {
  const color = tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : "var(--text-primary)";
  return <div style={{ padding: 12, borderRadius: 12, minWidth: 0, background: "var(--surface-muted)", border: "1px solid var(--border)" }}><div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 800, color }}>{value || 0}</div></div>;
}

const hintStyle = { margin: "0 0 12px", color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 };
const fileStyle = { marginTop: 12, color: "var(--text-secondary)", fontSize: 13 };
const errorStyle = { padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,.08)", color: "var(--danger)", fontSize: 13 };
const actionsStyle = { marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 };
const summaryStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 16 };

export default AlumniImportModal;
