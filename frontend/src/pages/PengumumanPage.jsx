import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaEye,
  FaEdit,
  FaTrash,
  FaImage,
  FaToggleOn,
  FaToggleOff,
  FaSearch,
} from "react-icons/fa";
import api from "../services/api";
import { uploadImage } from "../services/upload";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import Modal from "../components/Modal";
import { OperationalPageStyles } from "../components/shared/OperationalPageStyles";
import { formatNumber } from "../utils/formatCurrency";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import {
  FormField,
  Input,
  Select,
  Textarea,
  FormGrid,
  FormActionBar,
} from "../components/ui/form";
import { getApiError } from "../components/pembayaran/pembayaranShared";
import { useActiveUnit } from "../context/ActiveUnitContext";

const COVER_WIDTH = 1200;
const COVER_HEIGHT = 675;
const COVER_RATIO = 16 / 9;

const PRIORITAS_OPTIONS = [
  { value: "normal", label: "Normal", variant: "neutral" },
  { value: "penting", label: "Penting", variant: "warning" },
  { value: "urgent", label: "Urgent", variant: "danger" },
];

function prioritasMeta(p) {
  return PRIORITAS_OPTIONS.find((o) => o.value === p) ?? PRIORITAS_OPTIONS[0];
}

function formatDt(dt) {
  if (!dt) return "-";
  return new Date(dt).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function itemTimestamp(item) {
  return new Date(item.published_at ?? item.created_at ?? 0).getTime();
}

async function processCoverImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        let sx = 0;
        let sy = 0;
        let sw = width;
        let sh = height;
        const ratio = width / height;

        if (ratio > COVER_RATIO) {
          sw = height * COVER_RATIO;
          sx = (width - sw) / 2;
        } else if (ratio < COVER_RATIO) {
          sh = width / COVER_RATIO;
          sy = (height - sh) / 2;
        }

        canvas.width = COVER_WIDTH;
        canvas.height = COVER_HEIGHT;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COVER_WIDTH, COVER_HEIGHT);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl, fileName) {
  const [metadata, base64Data] = dataUrl.split(",");
  const mime = metadata?.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], fileName, { type: mime });
}

const EMPTY_FORM = {
  judul: "",
  isi: "",
  cover_url: "",
  prioritas: "normal",
  expires_at: "",
  is_active: true,
  unit_id: "",
};

function PengumumanPageStyles() {
  return (
    <style>{`
      .pengumuman-page {
        min-width: 0;
        max-width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .pengumuman-page .ops-page__form-card > div,
      .pengumuman-page .ops-page__empty > div {
        border-radius: 20px !important;
      }

      .pengumuman-cover-placeholder {
        width: 100%;
        height: 100%;
        min-height: 120px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--text-muted);
        background: linear-gradient(145deg, #15803D 0%, #166534 100%);
      }

      .pengumuman-cover-placeholder span {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.85;
        color: rgba(255, 255, 255, 0.75);
      }

      .pengumuman-cover {
        width: 100%;
        aspect-ratio: 16 / 9;
        border-radius: 20px;
        overflow: hidden;
        background: var(--neutral-subtle);
        border: 1px solid var(--border);
      }

      .pengumuman-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .pengumuman-cover--thumb {
        border-radius: var(--radius-lg);
      }

      .pengumuman-cover--hero {
        border-radius: 20px;
      }

      .pengumuman-clamp-3 {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .pengumuman-hero {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 20px;
        overflow: hidden;
        box-shadow: 0 2px 16px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.04);
      }

      .pengumuman-hero-body {
        padding: var(--space-5) var(--space-6);
      }

      .pengumuman-hero-title {
        margin: 0;
        font-size: clamp(1.35rem, 2.5vw, 1.75rem);
        font-weight: 800;
        line-height: 1.25;
        color: var(--text-primary);
        cursor: pointer;
      }

      .pengumuman-hero-preview {
        margin: var(--space-3) 0 0;
        font-size: 15px;
        line-height: 1.65;
        color: var(--text-secondary);
      }

      .pengumuman-feed-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        margin-top: var(--space-6);
      }

      .pengumuman-feed-item {
        display: grid;
        grid-template-columns: minmax(0, 220px) minmax(0, 1fr) auto;
        gap: var(--space-4);
        align-items: start;
        padding: var(--space-5);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: 0 2px 12px rgba(15, 23, 42, 0.04);
        transition: box-shadow 180ms ease, transform 180ms ease;
      }

      .pengumuman-feed-item:hover {
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.07);
        transform: translateY(-1px);
      }

      .pengumuman-feed-item--inactive {
        opacity: 0.72;
      }

      .pengumuman-feed-thumb {
        cursor: pointer;
      }

      .pengumuman-feed-title {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
        line-height: 1.35;
        color: var(--text-primary);
        cursor: pointer;
        letter-spacing: -0.02em;
      }

      .pengumuman-feed-preview {
        margin: var(--space-2) 0 0;
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-secondary);
      }

      .pengumuman-feed-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
      }

      .pengumuman-feed-date {
        font-size: 12px;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .pengumuman-icon-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: flex-start;
        justify-content: flex-end;
      }

      .pengumuman-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface);
        color: var(--text-secondary);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }

      .pengumuman-icon-btn:hover {
        background: var(--neutral-subtle);
        color: var(--text-primary);
        border-color: var(--border-hover);
      }

      .pengumuman-icon-btn--danger:hover {
        background: var(--danger-subtle);
        color: var(--danger);
        border-color: var(--danger-subtle);
      }

      .pengumuman-filter-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .pengumuman-filter-pill {
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface);
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }

      .pengumuman-filter-pill--active {
        background: var(--primary);
        border-color: var(--primary);
        color: var(--surface);
      }

      .pengumuman-toolbar {
        margin-bottom: 0;
      }

      .pengumuman-toolbar .filter-bar-v3__fields {
        flex: 1;
        min-width: 0;
      }

      .pengumuman-toolbar .filter-bar-v3__fields .form-control-v3,
      .pengumuman-toolbar .filter-bar-v3__fields input {
        max-width: 100%;
      }

      .pengumuman-read-modal {
        background: var(--surface);
        border-radius: var(--radius-xl);
        width: 100%;
        max-width: 760px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: var(--shadow-lg);
      }

      .pengumuman-read-body {
        padding: var(--space-6);
      }

      .pengumuman-read-title {
        margin: var(--space-4) 0 var(--space-3);
        font-size: clamp(1.35rem, 3vw, 1.875rem);
        font-weight: 800;
        line-height: 1.25;
        color: var(--text-primary);
      }

      .pengumuman-read-content {
        margin: var(--space-4) 0 0;
        font-size: 15px;
        line-height: 1.75;
        color: var(--text-primary);
        white-space: pre-wrap;
      }

      @media (max-width: 767px) {
        .pengumuman-feed-item {
          grid-template-columns: 1fr;
        }

        .pengumuman-icon-actions {
          justify-content: flex-start;
        }

        .pengumuman-hero-body {
          padding: var(--space-4);
        }

        .pengumuman-read-body {
          padding: var(--space-4);
        }

        .pengumuman-toolbar-search {
          max-width: none;
          flex: 1 1 100%;
        }
      }
    `}</style>
  );
}

function CoverPlaceholder({ compact = false }) {
  return (
    <div className="pengumuman-cover-placeholder">
      <FaImage style={{ fontSize: compact ? "22px" : "28px", opacity: 0.7, color: "var(--surface)" }} />
      <span>Pengumuman Pesantren</span>
    </div>
  );
}

function AnnouncementCover({
  coverUrl,
  variant = "hero",
  onClick,
  className = "",
}) {
  const coverClass = `pengumuman-cover pengumuman-cover--${variant} ${className}`.trim();

  return (
    <div
      className={coverClass}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      {coverUrl ? (
        <img src={coverUrl} alt="" />
      ) : (
        <CoverPlaceholder compact={variant === "thumb"} />
      )}
    </div>
  );
}

function IconAction({ label, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      className={`pengumuman-icon-btn${danger ? " pengumuman-icon-btn--danger" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CardActions({ item, onPreview, onEdit, onToggle, onRemove }) {
  return (
    <div className="pengumuman-icon-actions">
      <IconAction label="Baca" onClick={() => onPreview(item)}>
        <FaEye size={14} />
      </IconAction>
      <IconAction label="Edit" onClick={() => onEdit(item)}>
        <FaEdit size={14} />
      </IconAction>
      <IconAction label={item.is_active ? "Nonaktifkan" : "Aktifkan"} onClick={() => onToggle(item)}>
        {item.is_active ? <FaToggleOn size={15} /> : <FaToggleOff size={15} />}
      </IconAction>
      <IconAction label="Hapus" danger onClick={() => onRemove(item.id)}>
        <FaTrash size={13} />
      </IconAction>
    </div>
  );
}

function FeaturedHero({ item, onPreview, onEdit, onToggle, onRemove }) {
  const prioritas = prioritasMeta(item.prioritas);

  return (
    <article className="pengumuman-hero">
      <AnnouncementCover
        coverUrl={item.cover_url}
        variant="hero"
        onClick={() => onPreview(item)}
      />
      <div className="pengumuman-hero-body">
        <div className="pengumuman-feed-meta">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <StatusBadge status="terbaru" size="sm">
              Terbaru
            </StatusBadge>
            <StatusBadge status={item.prioritas} size="sm">
              {prioritas.label}
            </StatusBadge>
            <StatusBadge status={item.is_active ? "Aktif" : "Nonaktif"} size="sm" />
          </div>
          <time className="pengumuman-feed-date">
            {formatDt(item.published_at ?? item.created_at)}
          </time>
        </div>

        <h2 className="pengumuman-hero-title" onClick={() => onPreview(item)}>
          {item.judul}
        </h2>

        <p className="pengumuman-hero-preview pengumuman-clamp-3">{item.isi}</p>

        {item.expires_at && (
          <p style={{ margin: "var(--space-2) 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            Berlaku s/d {formatDt(item.expires_at)}
          </p>
        )}

        <FormActionBar className="form-action-bar-v3--compact" style={{ marginTop: "var(--space-4)", justifyContent: "flex-start" }}>
          <CardActions
            item={item}
            onPreview={onPreview}
            onEdit={onEdit}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        </FormActionBar>
      </div>
    </article>
  );
}

function FeedListItem({ item, onPreview, onEdit, onToggle, onRemove }) {
  const prioritas = prioritasMeta(item.prioritas);

  return (
    <article
      className={`pengumuman-feed-item${item.is_active ? "" : " pengumuman-feed-item--inactive"}`}
    >
      <div className="pengumuman-feed-thumb">
        <AnnouncementCover
          coverUrl={item.cover_url}
          variant="thumb"
          onClick={() => onPreview(item)}
        />
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="pengumuman-feed-meta">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <StatusBadge status={item.prioritas} size="sm">
              {prioritas.label}
            </StatusBadge>
            <StatusBadge status={item.is_active ? "Aktif" : "Nonaktif"} size="sm" />
          </div>
          <time className="pengumuman-feed-date">
            {formatDt(item.published_at ?? item.created_at)}
          </time>
        </div>

        <h3 className="pengumuman-feed-title" onClick={() => onPreview(item)}>
          {item.judul}
        </h3>

        <p className="pengumuman-feed-preview pengumuman-clamp-3">{item.isi}</p>

        {item.expires_at && (
          <p style={{ margin: "var(--space-2) 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            Berlaku s/d {formatDt(item.expires_at)}
          </p>
        )}
      </div>

      <CardActions
        item={item}
        onPreview={onPreview}
        onEdit={onEdit}
        onToggle={onToggle}
        onRemove={onRemove}
      />
    </article>
  );
}

function ReadArticleModal({ item, open, onClose }) {
  if (!item) return null;

  const prioritas = prioritasMeta(item.prioritas);

  return (
    <Modal open={open} title={item.judul} onClose={onClose} width={760}>
      <AnnouncementCover coverUrl={item.cover_url} variant="hero" />
      <div style={{ marginTop: "var(--space-4)" }}>
        <div className="pengumuman-feed-meta">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <StatusBadge status={item.prioritas}>{prioritas.label}</StatusBadge>
            <StatusBadge status={item.is_active ? "Aktif" : "Nonaktif"} />
          </div>
          <time className="pengumuman-feed-date">
            {formatDt(item.published_at ?? item.created_at)}
          </time>
        </div>

        {item.expires_at && (
          <p style={{ margin: "var(--space-2) 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
            Berlaku s/d {formatDt(item.expires_at)}
          </p>
        )}

        <div className="pengumuman-read-content">{item.isi}</div>
      </div>
      <FormActionBar className="form-action-bar-v3--compact">
        <Button type="button" variant="outline" onClick={onClose}>
          Tutup
        </Button>
      </FormActionBar>
    </Modal>
  );
}

function PengumumanPage() {
  const { activeUnitId, activeUnit, allUnitsAllowed } = useActiveUnit();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const fileInputRef = useRef(null);

  const getList = useCallback(async () => {
    try {
      setLoading(true);
      const params = activeUnitId ? { unit_id: activeUnitId } : (allUnitsAllowed ? { scope: "all" } : {});
      const res = await api.get("/pengumuman", { params });
      setList(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeUnitId, allUnitsAllowed]);

  useEffect(() => {
    getList();
    setForm((prev) => ({ ...prev, unit_id: activeUnitId ? String(activeUnitId) : "" }));
    setEditId(null);
    setFormOpen(false);
  }, [activeUnitId, getList]);

  const openCreate = () => {
    if (!activeUnitId) {
      alert("Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data.");
      return;
    }
    setForm({ ...EMPTY_FORM, unit_id: String(activeUnitId) });
    setEditId(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.judul.trim() || !form.isi.trim()) {
      alert("Judul dan isi wajib diisi.");
      return;
    }
    if (!activeUnitId) {
      alert("Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data.");
      return;
    }
    try {
      const payload = {
        ...form,
        unit_id: activeUnitId,
        expires_at: form.expires_at || null,
        cover_url: form.cover_url || null,
      };
      if (editId) {
        await api.put(`/pengumuman/${editId}`, payload);
      } else {
        await api.post("/pengumuman", payload);
      }
      setForm(EMPTY_FORM);
      setEditId(null);
      setFormOpen(false);
      getList();
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Gagal menyimpan pengumuman."));
    }
  };

  const startEdit = (item) => {
    if (!activeUnitId || Number(item.unit_id) !== Number(activeUnitId)) {
      alert("Pilih unit pengumuman terlebih dahulu untuk melakukan perubahan data.");
      return;
    }
    setForm({
      judul: item.judul,
      isi: item.isi,
      cover_url: item.cover_url || "",
      prioritas: item.prioritas ?? "normal",
      expires_at: item.expires_at ? item.expires_at.split("T")[0] : "",
      is_active: item.is_active,
      unit_id: item.unit_id ? String(item.unit_id) : "",
    });
    setEditId(item.id);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleActive = async (item) => {
    if (!activeUnitId) {
      alert("Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data.");
      return;
    }
    try {
      await api.put(`/pengumuman/${item.id}`, {
        is_active: !item.is_active,
        unit_id: activeUnitId,
      });
      getList();
    } catch (err) {
      console.error(err);
      alert("Gagal mengubah status.");
    }
  };

  const remove = async (id) => {
    if (!activeUnitId) {
      alert("Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data.");
      return;
    }
    if (!window.confirm("Hapus pengumuman ini?")) return;
    try {
      await api.delete(`/pengumuman/${id}`, { params: { unit_id: activeUnitId } });
      getList();
    } catch (err) {
      console.error(err);
      alert("Gagal menghapus.");
    }
  };

  const cancel = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setFormOpen(false);
  };

  const handleCoverPick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("File harus berupa gambar.");
      return;
    }
    try {
      setCoverUploading(true);
      const dataUrl = await processCoverImage(file);
      const coverFile = dataUrlToFile(dataUrl, `pengumuman-cover-${Date.now()}.jpg`);
      const coverUrl = await uploadImage(coverFile);
      setForm((prev) => ({ ...prev, cover_url: coverUrl }));
    } catch (err) {
      console.error(err);
      alert("Gagal mengupload gambar cover.");
    } finally {
      setCoverUploading(false);
    }
  };

  const stats = useMemo(
    () => ({
      total: list.length,
      aktif: list.filter((p) => p.is_active).length,
      prioritasTinggi: list.filter(
        (p) => p.prioritas === "urgent" || p.prioritas === "penting",
      ).length,
    }),
    [list],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return [...list]
      .filter((p) => {
        const matchesSearch =
          !q ||
          p.judul?.toLowerCase().includes(q) ||
          p.isi?.toLowerCase().includes(q);

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" && p.is_active) ||
          (statusFilter === "inactive" && !p.is_active);

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
  }, [list, search, statusFilter]);

  const featuredItem = filtered[0] ?? null;
  const feedItems = filtered.slice(1);

  return (
    <AppShell
      title="Pengumuman"
      description="Kelola pengumuman yang tampil di APK Wali Santri."
      breadcrumb="Sistem / Pengumuman"
    >
      <PengumumanPageStyles />
      <OperationalPageStyles />
      <div className="pengumuman-page ops-page">
        {!formOpen && (
          <div className="ops-page__summary">
            <div className="ops-page__stat">
              <span className="ops-page__stat-label">Total Pengumuman</span>
              <span className="ops-page__stat-value">{formatNumber(stats.total)}</span>
            </div>
            <div className="ops-page__stat">
              <span className="ops-page__stat-label">Aktif</span>
              <span className="ops-page__stat-value">{formatNumber(stats.aktif)}</span>
            </div>
            <div className="ops-page__stat">
              <span className="ops-page__stat-label">Prioritas Tinggi</span>
              <span className="ops-page__stat-value">{formatNumber(stats.prioritasTinggi)}</span>
            </div>
          </div>
        )}

        {!formOpen && (
          <div className="pengumuman-toolbar ops-page__filter filter-bar-v3 filter-bar-v3--table">
            <span className="filter-bar-v3__label">
              <FaSearch size={11} aria-hidden />
              Cari pengumuman
            </span>
            <div className="filter-bar-v3__fields">
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari judul atau isi pengumuman..."
              />
            </div>
            <div className="pengumuman-filter-pills">
              {[
                { key: "all", label: "Semua" },
                { key: "active", label: "Aktif" },
                { key: "inactive", label: "Nonaktif" },
              ].map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  className={`pengumuman-filter-pill${
                    statusFilter === pill.key ? " pengumuman-filter-pill--active" : ""
                  }`}
                  onClick={() => setStatusFilter(pill.key)}
                >
                  {pill.label}
                </button>
              ))}
            </div>
            <div className="ops-page__filter-actions">
              <Button type="button" variant="primary" onClick={openCreate}>
                + Buat Pengumuman
              </Button>
            </div>
          </div>
        )}

        {formOpen && (
          <div className="ops-page__form-card">
          <Card padding="md" shadow="card" border={false} radius="xl">
            <p style={formEyebrowStyle}>{editId ? "Edit Pengumuman" : "Pengumuman Baru"}</p>

            <FormField label="Cover Image" helper="Rasio 16:9 · direkomendasikan 1200 × 675 px">
              <div style={coverEditorStyle}>
                <AnnouncementCover coverUrl={form.cover_url} variant="hero" />
                <div style={coverActionsStyle}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleCoverPick}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={coverUploading}
                  >
                    {coverUploading ? "Memproses..." : form.cover_url ? "Ganti Cover" : "Upload Cover"}
                  </Button>
                  {form.cover_url && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setForm({ ...form, cover_url: "" })}
                    >
                      Hapus Cover
                    </Button>
                  )}
                </div>
              </div>
            </FormField>

            <FormField label="Judul" htmlFor="pengumuman-judul" required>
              <Input
                id="pengumuman-judul"
                placeholder="Judul pengumuman"
                value={form.judul}
                onChange={(e) => setForm({ ...form, judul: e.target.value })}
                maxLength={200}
              />
            </FormField>
            <FormField label="Unit Pendidikan">
              <Input value={activeUnit?.nama || "Pilih unit pada ruang kerja global"} disabled />
            </FormField>

            <FormField label="Isi Pengumuman" htmlFor="pengumuman-isi" required>
              <Textarea
                id="pengumuman-isi"
                placeholder="Tulis informasi pesantren, kegiatan, agenda, atau pengumuman penting..."
                value={form.isi}
                onChange={(e) => setForm({ ...form, isi: e.target.value })}
                rows={6}
              />
            </FormField>

            <details style={advancedWrapStyle}>
              <summary style={advancedSummaryStyle}>Pengaturan lanjutan</summary>
              <FormGrid style={{ marginTop: "var(--space-3)" }}>
                <FormField label="Prioritas" htmlFor="pengumuman-prioritas">
                  <Select
                    id="pengumuman-prioritas"
                    value={form.prioritas}
                    onChange={(e) => setForm({ ...form, prioritas: e.target.value })}
                  >
                    {PRIORITAS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Berlaku Hingga (opsional)" htmlFor="pengumuman-expires">
                  <Input
                    id="pengumuman-expires"
                    type="date"
                    value={form.expires_at}
                    onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                  />
                </FormField>
                <FormField label="Status" htmlFor="pengumuman-status">
                  <Select
                    id="pengumuman-status"
                    value={form.is_active ? "1" : "0"}
                    onChange={(e) => setForm({ ...form, is_active: e.target.value === "1" })}
                  >
                    <option value="1">Aktif</option>
                    <option value="0">Nonaktif</option>
                  </Select>
                </FormField>
              </FormGrid>
            </details>

            <FormActionBar className="form-action-bar-v3--compact">
              <Button type="button" variant="primary" onClick={save}>
                {editId ? "Simpan Perubahan" : "Simpan Pengumuman"}
              </Button>
              <Button type="button" variant="outline" onClick={cancel}>
                Batal
              </Button>
            </FormActionBar>
          </Card>
          </div>
        )}

        <div>
          <div style={feedHeaderStyle}>
            <div>
              <h2 style={feedTitleStyle}>Portal Berita Pesantren</h2>
              <p style={feedSubtitleStyle}>
                Feed informasi modern — siap ditampilkan di APK Wali Santri
              </p>
            </div>
            <span className="ops-page__meta">{filtered.length} pengumuman</span>
          </div>

          {loading ? (
            <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-4)" }}>Memuat feed...</p>
          ) : filtered.length === 0 ? (
            <div className="ops-page__empty">
            <Card padding="none" shadow="card" border={false} radius="xl">
              <EmptyState
                title={list.length === 0 ? "Belum ada pengumuman" : "Tidak ada hasil pencarian"}
                description={
                  list.length === 0
                    ? "Buat pengumuman pertama untuk membagikan informasi ke wali santri."
                    : "Coba kata kunci lain atau ubah filter status."
                }
                action={
                  list.length === 0 && !formOpen ? (
                    <Button type="button" variant="primary" onClick={openCreate}>
                      + Buat Pengumuman Pertama
                    </Button>
                  ) : null
                }
              />
            </Card>
            </div>
          ) : (
            <>
              {featuredItem && (
                <FeaturedHero
                  item={featuredItem}
                  onPreview={setPreviewItem}
                  onEdit={startEdit}
                  onToggle={toggleActive}
                  onRemove={remove}
                />
              )}

              {feedItems.length > 0 && (
                <div className="pengumuman-feed-list">
                  {feedItems.map((item) => (
                    <FeedListItem
                      key={item.id}
                      item={item}
                      onPreview={setPreviewItem}
                      onEdit={startEdit}
                      onToggle={toggleActive}
                      onRemove={remove}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <ReadArticleModal
          open={!!previewItem}
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      </div>
    </AppShell>
  );
}

const formEyebrowStyle = {
  margin: "0 0 var(--space-4)",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
};

const coverEditorStyle = {
  borderRadius: "20px",
  overflow: "hidden",
  border: "1px solid var(--border)",
  background: "var(--background)",
  boxShadow: "0 2px 16px rgba(15, 23, 42, 0.05)",
};

const coverActionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  padding: "12px 14px",
  borderTop: "1px solid var(--border)",
  background: "var(--surface)",
};

const advancedWrapStyle = {
  marginTop: "16px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid var(--border)",
  background: "var(--background)",
};

const advancedSummaryStyle = {
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--text-secondary)",
};

const feedHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
  marginBottom: "var(--space-4)",
  flexWrap: "wrap",
};

const feedTitleStyle = {
  margin: 0,
  fontSize: "20px",
  fontWeight: 800,
  color: "var(--text-primary)",
  letterSpacing: "-0.02em",
};

const feedSubtitleStyle = {
  margin: "4px 0 0",
  fontSize: "13px",
  color: "var(--text-secondary)",
  lineHeight: 1.5,
};

export default PengumumanPage;
