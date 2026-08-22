import { useMemo, useState } from "react";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { FormActionBar, FormField, FormGrid, Input } from "../components/ui/form";
import SantriSearchPicker from "../components/rfid/SantriSearchPicker";
import { formatCurrency } from "../utils/formatCurrency";
import { getUser } from "../utils/storage";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { requireActiveUnitForWrite } from "../utils/unitScopeParams";

function WalletWithdrawalPage() {
  const { activeUnitId } = useActiveUnit();
  const writeScopeParams = useMemo(
    () => (activeUnitId ? { unit_id: activeUnitId } : null),
    [activeUnitId],
  );
  const petugas = getUser()?.nama || getUser()?.username || "Petugas";
  const [santriId, setSantriId] = useState("");
  const [selectedSantri, setSelectedSantri] = useState(null);
  const [nominal, setNominal] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const amount = Number(nominal);
    if (!santriId) return alert("Pilih santri terlebih dahulu");
    if (!Number.isSafeInteger(amount) || amount <= 0) return alert("Nominal penarikan tidak valid");
    if (amount > Number(selectedSantri?.saldo || 0)) return alert("Saldo tidak cukup");
    if (!keterangan.trim()) return alert("Keterangan penarikan wajib diisi");
    let unitPayload;
    try {
      unitPayload = requireActiveUnitForWrite({ activeUnitId });
    } catch (err) {
      alert(err.message);
      return;
    }
    if (!window.confirm(`Tarik ${formatCurrency(amount)} dari dompet ${selectedSantri?.nama}?`)) return;

    setLoading(true);
    try {
      const response = await api.post("/rfid/withdrawal", {
        santri_id: Number(santriId),
        nominal: amount,
        keterangan: keterangan.trim(),
        ...unitPayload,
      });
      const data = response.data.data;
      setSelectedSantri((current) => ({ ...current, saldo: data.saldo_akhir }));
      setNominal("");
      setKeterangan("");
      alert(`Penarikan berhasil. Saldo terbaru ${formatCurrency(data.saldo_akhir)}`);
    } catch (err) {
      alert(err?.response?.data?.error || "Penarikan saldo gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell
      title="Penarikan Saldo"
      description="Kurangi saldo Dompet Santri secara manual tanpa kartu RFID"
      breadcrumb="Keuangan / Dompet Santri / Penarikan"
    >
      <Card padding="md" shadow="card" border={false} radius="xl">
        <FormGrid>
          <SantriSearchPicker
            id="withdrawal-santri"
            value={santriId}
            onChange={setSantriId}
            onSelect={setSelectedSantri}
            selectedSantri={selectedSantri}
            params={writeScopeParams}
            disabled={loading}
            required
          />
          <FormField label="Nominal Penarikan" htmlFor="withdrawal-amount" required>
            <Input
              id="withdrawal-amount"
              type="number"
              min="1"
              step="1"
              value={nominal}
              onChange={(event) => setNominal(event.target.value)}
              disabled={loading}
            />
          </FormField>
          <FormField label="Keterangan" htmlFor="withdrawal-note" required>
            <Input
              id="withdrawal-note"
              value={keterangan}
              maxLength={250}
              onChange={(event) => setKeterangan(event.target.value)}
              placeholder="Contoh: uang saku tunai"
              disabled={loading}
            />
          </FormField>
          <FormField label="Nama Petugas" htmlFor="withdrawal-officer">
            <Input id="withdrawal-officer" value={petugas} disabled readOnly />
          </FormField>
        </FormGrid>

        {selectedSantri ? (
          <div className="form-modal-summary-v3" style={{ marginTop: "var(--space-4)" }}>
            <p><strong>Santri:</strong> {selectedSantri.nama}</p>
            <p><strong>Petugas:</strong> {petugas}</p>
            <p><strong>Saldo Saat Ini:</strong> {formatCurrency(Number(selectedSantri.saldo || 0))}</p>
            <p><strong>Saldo Setelah Penarikan:</strong> {formatCurrency(Math.max(Number(selectedSantri.saldo || 0) - Number(nominal || 0), 0))}</p>
          </div>
        ) : null}

        <FormActionBar className="form-action-bar-v3--compact">
          <Button type="button" variant="primary" onClick={submit} disabled={loading}>
            {loading ? "Memproses..." : "Proses Penarikan"}
          </Button>
        </FormActionBar>
      </Card>
    </AppShell>
  );
}

export default WalletWithdrawalPage;
