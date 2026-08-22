import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import { exportExcel } from "../utils/exportExcel";
import { getUser } from "../utils/storage";
import GenerateTagihanForm from "../components/pembayaran/GenerateTagihanForm";
import TagihanTable from "../components/pembayaran/TagihanTable";
import BayarModal from "../components/pembayaran/BayarModal";
import HistoriModal from "../components/pembayaran/HistoriModal";
import SahriyahInvoiceModal from "../components/sahriyah/SahriyahInvoiceModal";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";
import { DEFAULT_PAGE_SIZE } from "../hooks/useClientPagination";
import {
  KeuanganResponsiveStyles,
  getApiError,
  isTagihanLunas,
  getBulanNamaBerjalan,
  getTahunBerjalan,
  normalizeBulanToName,
} from "../components/pembayaran/pembayaranShared";

function buildListParams({
  filterBulan,
  filterTahun,
  filterJenis,
  filterStatus,
  tableSearch,
  page,
  limit = DEFAULT_PAGE_SIZE,
}) {
  const params = {
    bulan: filterBulan,
    tahun: filterTahun,
    limit,
    offset: (page - 1) * limit,
  };

  if (filterJenis) params.jenis_tagihan_id = filterJenis;
  if (filterStatus) params.status = filterStatus;
  if (tableSearch.trim()) params.search = tableSearch.trim();

  return params;
}

function PembayaranPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const writeScopeParams = useMemo(
    () => (activeUnitId ? { unit_id: activeUnitId } : null),
    [activeUnitId],
  );
  const [pembayaran, setPembayaran] = useState([]);
  const [pagination, setPagination] = useState({
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [isLoadingTable, setIsLoadingTable] = useState(false);
  const [kelas, setKelas] = useState([]);
  const [jenisTagihan, setJenisTagihan] = useState([]);
  const [tableSearch, setTableSearch] = useState("");
  const [filterBulan, setFilterBulan] = useState(getBulanNamaBerjalan());
  const [filterTahun, setFilterTahun] = useState(getTahunBerjalan());
  const [filterJenis, setFilterJenis] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({
    santri_id: "",
    nama_tagihan: "",
    bulan: "",
    tahun: 2026,
    nominal_tagihan: "",
    nominal_bayar: "",
  });
  const [modeGenerate, setModeGenerate] = useState("semua");
  const [selectedSantriItems, setSelectedSantriItems] = useState([]);
  const [selectedKelas, setSelectedKelas] = useState("");
  const [previewCount, setPreviewCount] = useState(0);
  const [showRiwayat, setShowRiwayat] = useState(false);
  const [riwayat, setRiwayat] = useState([]);
  const [showBayar, setShowBayar] = useState(false);
  const [selectedTagihan, setSelectedTagihan] = useState(null);
  const [nominalBayar, setNominalBayar] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingBayar, setIsSavingBayar] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);

  const searchDebounceRef = useRef(null);

  const fetchPembayaran = useCallback(
    async (pageNum = 1) => {
      setIsLoadingTable(true);

      try {
        const params = buildListParams({
          filterBulan,
          filterTahun,
          filterJenis,
          filterStatus,
          tableSearch,
          page: pageNum,
        });
        Object.assign(params, readScopeParams);

        const response = await api.get("/pembayaran", { params });
        setPembayaran(response.data.data || []);
        setPagination(
          response.data.pagination || {
            limit: DEFAULT_PAGE_SIZE,
            offset: 0,
            total: 0,
          },
        );
        setPage(pageNum);
      } catch (err) {
        console.error(err);
        alert(getApiError(err, "Gagal memuat data pembayaran"));
      } finally {
        setIsLoadingTable(false);
      }
    },
    [filterBulan, filterTahun, filterJenis, filterStatus, tableSearch, readScopeParams],
  );

  const fetchPreview = useCallback(async () => {
    try {
      if (!activeUnitId) {
        setPreviewCount(0);
        return;
      }
      const params = { scope: "all", unit_id: activeUnitId };

      if (modeGenerate === "kelas") {
        params.scope = "kelas";
        params.kelas_id = selectedKelas;
        if (!selectedKelas) {
          setPreviewCount(0);
          return;
        }
      } else if (modeGenerate === "pilih") {
        params.scope = "selected";
        params.santri_ids = selectedSantriItems.map((s) => s.id).join(",");
        setPreviewCount(selectedSantriItems.length);
        return;
      }

      const response = await api.get("/pembayaran/generate-preview", { params });
      setPreviewCount(response.data.total_target || 0);
    } catch (err) {
      console.error(err);
      setPreviewCount(0);
    }
  }, [activeUnitId, modeGenerate, selectedKelas, selectedSantriItems]);

  useEffect(() => {
    getKelas();
  }, [readScopeParams]);

  useEffect(() => {
    getJenisTagihan();
  }, []);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      fetchPembayaran(1);
    }, tableSearch.trim() ? 300 : 0);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [filterBulan, filterTahun, filterJenis, filterStatus, tableSearch, fetchPembayaran]);

  const getKelas = async () => {
    try {
      const response = await api.get("/kelas", { params: readScopeParams });
      setKelas(response.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  const getJenisTagihan = async () => {
    try {
      const response = await api.get("/jenis-tagihan");
      setJenisTagihan(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddSantri = (santri) => {
    if (!santri?.id) return;
    setSelectedSantriItems((prev) => {
      if (prev.some((item) => String(item.id) === String(santri.id))) return prev;
      return [...prev, { id: santri.id, nama: santri.nama }];
    });
  };

  const handleRemoveSantri = (id) => {
    setSelectedSantriItems((prev) => prev.filter((item) => String(item.id) !== String(id)));
  };

  const createPembayaran = async () => {
    const normalizedBulan = normalizeBulanToName(form.bulan) || form.bulan;
    const scope =
      modeGenerate === "semua" ? "all" : modeGenerate === "kelas" ? "kelas" : "selected";

    if (!form.nama_tagihan?.trim()) {
      alert("Nama tagihan wajib diisi");
      return;
    }

    if (!normalizedBulan || !form.tahun || !form.nominal_tagihan) {
      alert("Bulan, tahun, dan nominal tagihan wajib diisi");
      return;
    }

    if (scope === "kelas" && !selectedKelas) {
      alert("Pilih kelas terlebih dahulu");
      return;
    }

    if (scope === "selected" && selectedSantriItems.length === 0) {
      alert("Pilih minimal satu santri untuk generate tagihan");
      return;
    }

    let writeScope;
    try {
      writeScope = requireActiveUnitForWrite({ activeUnitId });
    } catch (err) {
      alert(err.message);
      return;
    }

    const targetCount =
      scope === "selected" ? selectedSantriItems.length : previewCount;

    if (!targetCount) {
      alert("Tidak ada santri target untuk generate tagihan");
      return;
    }

    const yakin = window.confirm(`Generate tagihan untuk ${targetCount} santri?`);
    if (!yakin) return;

    setIsGenerating(true);

    try {
      const payload = {
        scope,
        nama_tagihan: form.nama_tagihan.trim(),
        bulan: normalizedBulan,
        tahun: Number(form.tahun),
        nominal_tagihan: Number(form.nominal_tagihan),
        ...writeScope,
      };

      if (scope === "kelas") payload.kelas_id = Number(selectedKelas);
      if (scope === "selected") {
        payload.santri_ids = selectedSantriItems.map((s) => s.id);
      }

      const response = await api.post("/pembayaran/generate", payload);

      const {
        created_count = 0,
        skipped_count = 0,
        skipped_nonaktif_count = 0,
        total_target = 0,
      } = response.data || {};

      alert(
        `Generate selesai.\n\nDibuat: ${created_count}\nDilewati: ${skipped_count}\nSantri nonaktif: ${skipped_nonaktif_count}\nTarget: ${total_target}`,
      );

      setForm({
        santri_id: "",
        nama_tagihan: "",
        bulan: "",
        tahun: 2026,
        nominal_tagihan: "",
        nominal_bayar: "",
      });

      setSelectedSantriItems([]);
      await getJenisTagihan();
      await fetchPembayaran(1);
      await fetchPreview();
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal membuat tagihan"));
    } finally {
      setIsGenerating(false);
    }
  };

  const bukaBayar = (tagihan) => {
    if (isTagihanLunas(tagihan.status)) return;
    setSelectedTagihan(tagihan);
    setNominalBayar("");
    setShowBayar(true);
  };

  const tutupBayar = () => {
    if (isSavingBayar) return;
    setShowBayar(false);
    setSelectedTagihan(null);
    setNominalBayar("");
  };

  const simpanPembayaran = async () => {
    if (isSavingBayar || !selectedTagihan) return;

    if (isTagihanLunas(selectedTagihan.status)) {
      alert("Tagihan sudah lunas dan tidak dapat dibayar lagi");
      return;
    }

    const user = getUser() || {};

    setIsSavingBayar(true);

    try {
      const response = await api.put(`/pembayaran/bayar/${selectedTagihan.id}`, {
        nominal: Number(nominalBayar),
        petugas: user?.nama || user?.username || "Admin",
        unit_id: activeUnitId,
      });

      alert("Pembayaran berhasil");
      await fetchPembayaran(page);
      setShowBayar(false);
      setSelectedTagihan(null);
      setNominalBayar("");

      if (response.data?.invoice_id) {
        await lihatInvoice(response.data.invoice_id);
      }
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal menyimpan pembayaran"));
    } finally {
      setIsSavingBayar(false);
    }
  };

  const hapusTagihan = async (id) => {
    const yakin = window.confirm("Hapus tagihan?");
    if (!yakin) return;

    try {
      await api.delete(`/pembayaran/${id}`, { params: { unit_id: activeUnitId } });
      await fetchPembayaran(page);
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal menghapus tagihan"));
    }
  };

  const lihatRiwayat = async (tagihan) => {
    try {
      const response = await api.get(`/pembayaran/riwayat/${tagihan.id}`, {
        params: { unit_id: activeUnitId },
      });
      setRiwayat(response.data.data);
      setShowRiwayat(true);
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal memuat riwayat pembayaran"));
    }
  };

  const lihatInvoice = async (invoiceId) => {
    if (!invoiceId) return;
    setShowInvoice(true);
    setIsLoadingInvoice(true);

    try {
      const response = await api.get(`/invoice/pembayaran/${invoiceId}`);
      setInvoice(response.data.data);
    } catch (err) {
      console.error(err);
      setShowInvoice(false);
      alert(getApiError(err, "Gagal memuat invoice"));
    } finally {
      setIsLoadingInvoice(false);
    }
  };

  const tutupInvoice = () => {
    setShowInvoice(false);
    setInvoice(null);
    setIsLoadingInvoice(false);
  };

  const printInvoice = async () => {
    if (!invoice?.invoice_id) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup print diblokir browser");
      return;
    }

    try {
      const response = await api.get(`/invoice/pembayaran/${invoice.invoice_id}/print`, {
        responseType: "text",
      });
      printWindow.document.open();
      printWindow.document.write(response.data);
      printWindow.document.close();
      printWindow.focus();
    } catch (err) {
      console.error(err);
      printWindow.close();
      alert(getApiError(err, "Gagal membuka print invoice"));
    }
  };

  const shareInvoiceWhatsApp = () => {
    const number = invoice?.wali?.whatsapp_number;
    if (!number) {
      alert("Nomor WhatsApp wali belum tersedia");
      return;
    }

    const text = encodeURIComponent(invoice.whatsapp_text || "");
    window.open(`https://wa.me/${number}?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const handleExport = async () => {
    try {
      const params = buildListParams({
        filterBulan,
        filterTahun,
        filterJenis,
        filterStatus,
        tableSearch,
        page: 1,
        limit: 10000,
      });
      Object.assign(params, readScopeParams);

      const response = await api.get("/pembayaran", { params });
      const rows = (response.data.data || []).map((p) => ({
        Santri: p.nama,
        Tagihan: p.nama_tagihan,
        Bulan: p.bulan,
        Tahun: p.tahun,
        Nominal: Number(p.nominal_tagihan),
        Dibayar: Number(p.nominal_bayar),
        Sisa: Number(p.sisa_tunggakan),
        Status: p.status,
      }));

      exportExcel(rows, "Pembayaran");
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal export pembayaran"));
    }
  };

  const handlePageChange = (nextPage) => {
    fetchPembayaran(nextPage);
  };

  return (
    <AppShell title="Pembayaran" breadcrumb="Keuangan / Pembayaran">
      <KeuanganResponsiveStyles />
      <div className="keuangan-page">
        <GenerateTagihanForm
          modeGenerate={modeGenerate}
          setModeGenerate={setModeGenerate}
          kelas={kelas}
          selectedSantriItems={selectedSantriItems}
          onSelectSantri={handleAddSantri}
          onRemoveSantri={handleRemoveSantri}
          selectedKelas={selectedKelas}
          setSelectedKelas={setSelectedKelas}
          previewCount={previewCount}
          form={form}
          setForm={setForm}
          onSubmit={createPembayaran}
          isGenerating={isGenerating}
          unitScopeParams={writeScopeParams}
        />

        <div style={{ marginTop: "var(--space-6)" }}>
          <TagihanTable
            pembayaran={pembayaran}
            pagination={pagination}
            page={page}
            onPageChange={handlePageChange}
            isLoading={isLoadingTable}
            tableSearch={tableSearch}
            onSearchChange={(e) => setTableSearch(e.target.value)}
            filterBulan={filterBulan}
            onFilterBulanChange={(e) => setFilterBulan(e.target.value)}
            filterTahun={filterTahun}
            onFilterTahunChange={(e) => setFilterTahun(Number(e.target.value))}
            filterJenis={filterJenis}
            onFilterJenisChange={(e) => setFilterJenis(e.target.value)}
            filterStatus={filterStatus}
            onFilterStatusChange={(e) => setFilterStatus(e.target.value)}
            jenisTagihanOptions={jenisTagihan}
            onExport={handleExport}
            onBayar={bukaBayar}
            onHistori={lihatRiwayat}
            onInvoice={lihatInvoice}
            onHapus={hapusTagihan}
          />
        </div>

        {showBayar && (
          <BayarModal
            tagihan={selectedTagihan}
            nominalBayar={nominalBayar}
            onNominalChange={setNominalBayar}
            onSave={simpanPembayaran}
            onClose={tutupBayar}
            isSaving={isSavingBayar}
          />
        )}

        <HistoriModal
          open={showRiwayat}
          riwayat={riwayat}
          onClose={() => setShowRiwayat(false)}
          onInvoice={lihatInvoice}
        />

        <SahriyahInvoiceModal
          open={showInvoice}
          invoice={invoice}
          loading={isLoadingInvoice}
          onClose={tutupInvoice}
          onPrint={printInvoice}
          onWhatsApp={shareInvoiceWhatsApp}
        />
      </div>
    </AppShell>
  );
}

export default PembayaranPage;
