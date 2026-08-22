import { useEffect, useState } from "react";
import Card from "../ui/Card";
import SectionHeading from "../ui/SectionHeading";
import Button from "../ui/Button";
import SantriSearchPicker from "../rfid/SantriSearchPicker";
import {
  FormField,
  Input,
  Select,
  FormGrid,
  FormSection,
  FormActionBar,
} from "../ui/form";
import { BULAN_NAMA, normalizeBulanToName } from "./pembayaranShared";

function GenerateTagihanForm({
  modeGenerate,
  setModeGenerate,
  kelas,
  selectedSantriItems,
  onSelectSantri,
  onRemoveSantri,
  selectedKelas,
  setSelectedKelas,
  previewCount = 0,
  form,
  setForm,
  onSubmit,
  isGenerating = false,
  unitScopeParams = null,
}) {
  const [bulanInput, setBulanInput] = useState(form.bulan || "");

  useEffect(() => {
    setBulanInput(form.bulan || "");
  }, [form.bulan]);

  const handleBulanBlur = () => {
    const normalized = normalizeBulanToName(bulanInput) || bulanInput;
    setBulanInput(normalized);
    setForm({ ...form, bulan: normalized });
  };

  return (
    <Card padding="md" shadow="card" border={false} radius="xl">
      <SectionHeading variant="eyebrow" spacing="first">
        Tambah Pembayaran
      </SectionHeading>

      <FormSection title="Target Tagihan">
        <div className="form-radio-group-v3">
          <label className="form-radio-option-v3">
            <input
              type="radio"
              checked={modeGenerate === "semua"}
              onChange={() => setModeGenerate("semua")}
            />
            Semua Santri
          </label>
          <label className="form-radio-option-v3">
            <input
              type="radio"
              checked={modeGenerate === "pilih"}
              onChange={() => setModeGenerate("pilih")}
            />
            Pilih Santri
          </label>
          <label className="form-radio-option-v3">
            <input
              type="radio"
              checked={modeGenerate === "kelas"}
              onChange={() => setModeGenerate("kelas")}
            />
            Berdasarkan Kelas
          </label>
        </div>

        {(modeGenerate === "semua" || modeGenerate === "kelas") && (
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
            Estimasi target: <strong>{previewCount}</strong> santri
          </p>
        )}

        {modeGenerate === "pilih" && (
          <FormGrid columns="single">
            <SantriSearchPicker
              key={`tagihan-picker-${selectedSantriItems.length}`}
              id="tagihan-santri-search"
              label="Cari Santri"
              value=""
              onChange={() => {}}
              onSelect={(santri) => {
                if (!santri) return;
                onSelectSantri(santri);
              }}
              disabled={isGenerating}
              params={unitScopeParams}
            />
            {selectedSantriItems.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {selectedSantriItems.map((s) => (
                  <span
                    key={s.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: "var(--primary-subtle, #eef2ff)",
                      fontSize: 13,
                    }}
                  >
                    {s.nama}
                    <button
                      type="button"
                      onClick={() => onRemoveSantri(s.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
                Belum ada santri dipilih. Gunakan pencarian di atas.
              </p>
            )}
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
              Target terpilih: <strong>{selectedSantriItems.length}</strong> santri
            </p>
          </FormGrid>
        )}

        {modeGenerate === "kelas" && (
          <FormGrid columns="single">
            <FormField label="Kelas" htmlFor="tagihan-kelas">
              <Select
                id="tagihan-kelas"
                value={selectedKelas}
                onChange={(e) => setSelectedKelas(e.target.value)}
              >
                <option value="">Pilih Kelas</option>
                {kelas.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama_kelas}
                  </option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
        )}
      </FormSection>

      <FormSection title="Detail Tagihan">
        <FormGrid>
          <FormField label="Nama Tagihan" htmlFor="tagihan-nama" required>
            <Input
              id="tagihan-nama"
              type="text"
              value={form.nama_tagihan}
              onChange={(e) => setForm({ ...form, nama_tagihan: e.target.value })}
            />
          </FormField>
          <FormField label="Bulan" htmlFor="tagihan-bulan">
            <Input
              id="tagihan-bulan"
              type="text"
              list="bulan-suggestions"
              value={bulanInput}
              onChange={(e) => setBulanInput(e.target.value)}
              onBlur={handleBulanBlur}
              placeholder="Juni, 6, atau 06"
            />
            <datalist id="bulan-suggestions">
              {BULAN_NAMA.map((nama) => (
                <option key={nama} value={nama} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Tahun" htmlFor="tagihan-tahun">
            <Input
              id="tagihan-tahun"
              type="number"
              value={form.tahun}
              onChange={(e) => setForm({ ...form, tahun: e.target.value })}
            />
          </FormField>
          <FormField label="Nominal Tagihan" htmlFor="tagihan-nominal" required>
            <Input
              id="tagihan-nominal"
              type="number"
              value={form.nominal_tagihan}
              onChange={(e) => setForm({ ...form, nominal_tagihan: e.target.value })}
            />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormActionBar className="form-action-bar-v3--compact">
        <Button onClick={onSubmit} disabled={isGenerating}>
          {isGenerating ? "Memproses..." : "Generate"}
        </Button>
      </FormActionBar>
    </Card>
  );
}

export default GenerateTagihanForm;
