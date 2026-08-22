import { useCallback, useRef, useState } from "react";
import Modal from "../Modal";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import {
  Table,
  TableScroll,
} from "../ui/table";
import api from "../../services/api";

function SantriImportModal({ open, onClose, onImported, unitId, unitName }) {
  const fileInputRef = useRef(null);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setStep(1);
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setLoading(false);
    setError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setPreview(null);
    setCommitResult(null);
    setError("");
    setStep(1);
  };

  const runPreview = async () => {
    if (!file) {
      setError("Pilih file Excel terlebih dahulu");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Format file harus .xlsx");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post("/santri/import/preview", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        params: { unit_id: unitId },
      });
      setPreview(res.data);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal preview file Excel");
    } finally {
      setLoading(false);
    }
  };

  const runCommit = async () => {
    if (!preview?.rows?.length) return;

    const validRows = preview.rows.filter((row) => row.status === "valid");
    if (validRows.length === 0) {
      setError("Tidak ada baris valid untuk diimport");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await api.post("/santri/import/commit", {
        rows: validRows,
        unit_id: unitId,
      });
      setCommitResult(res.data);
      setStep(3);
      if (res.data.imported > 0 && onImported) {
        onImported();
      }
    } catch (err) {
      setError(err.response?.data?.error || "Gagal import data santri");
    } finally {
      setLoading(false);
    }
  };

  const validCount = preview?.valid_rows ?? 0;

  return (
    <Modal open={open} title="Import Santri dari Excel" onClose={handleClose} width={920}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={stepperStyle}>
          <StepBadge active={step >= 1} label="1. Upload" />
          <StepBadge active={step >= 2} label="2. Preview" />
          <StepBadge active={step >= 3} label="3. Import" />
        </div>

        {error ? <div style={errorStyle}>{error}</div> : null}

        {step === 1 ? (
          <div>
            <p style={hintStyle}>
              Upload file Excel (.xlsx, maks. 5MB) untuk unit <strong>{unitName || "aktif"}</strong>.
              Kolom tenant_id akan diabaikan.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
            />
            {file ? (
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)" }}>
                File: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)
              </p>
            ) : null}
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <Button variant="primary" onClick={runPreview} disabled={!file || loading}>
                {loading ? "Memproses..." : "Preview Data"}
              </Button>
              <Button variant="secondary" onClick={handleClose}>
                Batal
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 && preview ? (
          <div>
            <div style={summaryGridStyle}>
              <SummaryCard label="Santri Baru" value={preview.summary?.NEW_SANTRI || 0} tone="success" />
              <SummaryCard label="Existing → unit" value={preview.summary?.ATTACH_EXISTING || 0} tone="success" />
              <SummaryCard label="Sudah di unit" value={preview.summary?.ALREADY_IN_UNIT || 0} />
              <SummaryCard label="Konflik" value={preview.summary?.CONFLICT || 0} tone="danger" />
              <SummaryCard label="Kelas invalid" value={preview.summary?.INVALID_CLASS || 0} tone="danger" />
            </div>

            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>Baris</th>
                    <th>Status</th>
                    <th>Klasifikasi</th>
                    <th>Nama</th>
                    <th>NIS</th>
                    <th>Kelas</th>
                    <th>Kamar / Asrama</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row_number}>
                      <td>{row.row_number}</td>
                      <td>
                        <Badge variant={row.status === "valid" ? "success" : "danger"}>
                          {row.status}
                        </Badge>
                      </td>
                      <td>{row.action || "—"}</td>
                      <td>{row.data?.nama || "—"}</td>
                      <td>{row.data?.nis || "—"}</td>
                      <td>{row.data?.kelas || "—"}</td>
                      <td>{row.data?.kamar || "—"}</td>
                      <td style={{ color: "var(--danger)", fontSize: 12 }}>
                        {row.errors?.join("; ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>

            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                variant="primary"
                onClick={runCommit}
                disabled={loading || validCount === 0}
              >
                {loading ? "Mengimport..." : `Proses Import ${validCount} Baris`}
              </Button>
              <Button variant="secondary" onClick={() => setStep(1)} disabled={loading}>
                Upload Ulang
              </Button>
              <Button variant="secondary" onClick={handleClose} disabled={loading}>
                Tutup
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 && commitResult ? (
          <div>
            <div style={summaryGridStyle}>
              <SummaryCard label="Santri Baru" value={commitResult.summary?.NEW_SANTRI || 0} tone="success" />
              <SummaryCard label="Existing → unit" value={commitResult.summary?.ATTACH_EXISTING || 0} tone="success" />
              <SummaryCard label="Sudah di unit" value={commitResult.summary?.ALREADY_IN_UNIT || 0} />
              <SummaryCard label="Gagal / review" value={commitResult.failed} tone="danger" />
            </div>

            {commitResult.imported_rows?.length ? (
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th>Baris</th>
                      <th>Aksi</th>
                      <th>ID Santri</th>
                      <th>NIS</th>
                      <th>Nama</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commitResult.imported_rows.map((row) => (
                      <tr key={`${row.row_number}-${row.santri_id}`}>
                        <td>{row.row_number}</td>
                        <td>{row.action || "—"}</td>
                        <td>{row.santri_id}</td>
                        <td>{row.nis || "—"}</td>
                        <td>{row.nama}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            ) : null}

            {commitResult.skipped?.length ? (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontWeight: 600, marginBottom: 8 }}>Baris dilewati:</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {commitResult.skipped.map((row) => (
                    <li key={row.row_number}>
                      Baris {row.row_number}: {row.errors?.join("; ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div style={{ marginTop: 16 }}>
              <Button variant="primary" onClick={handleClose}>
                Selesai
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function StepBadge({ active, label }) {
  return (
    <span
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: active ? "var(--primary)" : "var(--surface-muted)",
        color: active ? "#fff" : "var(--text-secondary)",
      }}
    >
      {label}
    </span>
  );
}

function SummaryCard({ label, value, tone }) {
  const color =
    tone === "success"
      ? "var(--success)"
      : tone === "danger"
        ? "var(--danger)"
        : "var(--text-primary)";

  return (
    <div style={summaryCardStyle}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

const stepperStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const hintStyle = {
  margin: "0 0 12px",
  fontSize: 13,
  color: "var(--text-secondary)",
};

const errorStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(239, 68, 68, 0.08)",
  color: "var(--danger)",
  fontSize: 13,
};

const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 12,
  marginBottom: 16,
};

const summaryCardStyle = {
  padding: 12,
  borderRadius: 12,
  background: "var(--surface-muted)",
  border: "1px solid var(--border)",
};

export default SantriImportModal;
