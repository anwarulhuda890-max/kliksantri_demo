import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Modal from "../components/Modal";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import EmptyState from "../components/ui/EmptyState";
import { LegacyPageStyles } from "../components/shared/PageResponsiveStyles";
import { Table, TableScroll, TableActions, TablePagination, useClientPagination } from "../components/ui/table";
import { FaCog } from "react-icons/fa";
import {
  FormField,
  Input,
  FormGrid,
  FormActionBar,
} from "../components/ui/form";
function RolesPage() {
  const [roles, setRoles]             = useState([]);
  const [allPerms, setAllPerms]       = useState([]);
  const [rbacReadOnly, setRbacReadOnly] = useState(true);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");

  const [matrixModal, setMatrixModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [checked, setChecked]         = useState(new Set());
  const [roleLabel, setRoleLabel]       = useState("");
  const [savingMatrix, setSavingMatrix] = useState(false);

  const [addModal, setAddModal]       = useState(false);
  const [newRole, setNewRole]         = useState({ name: "", label: "" });

  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const groupedPerms = useMemo(() => {
    const map = {};
    for (const p of allPerms) {
      const g = p.grup || "lainnya";
      if (!map[g]) map[g] = [];
      map[g].push(p);
    }
    return map;
  }, [allPerms]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [rRes, pRes] = await Promise.all([
        api.get("/roles"),
        api.get("/roles/permissions"),
      ]);
      setRoles(rRes.data.data || []);
      setAllPerms(pRes.data.data || []);
      setRbacReadOnly(
        Boolean(rRes.data.rbac_read_only ?? pRes.data.rbac_read_only ?? true),
      );
    } catch (err) {
      setError(err.response?.data?.error || "Gagal memuat data role");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const { page, setPage, paginatedItems, totalItems, pageSize } = useClientPagination(roles);

  useEffect(() => {
    setPage(1);
  }, [roles.length, setPage]);

  const flash = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 3500);
  };

  const openMatrix = async (role) => {
    setError("");
    try {
      const res = await api.get(`/roles/${role.id}`);
      const data = res.data.data || {};
      const keys = data.permissions || [];
      setSelectedRole({ ...role, ...data });
      setChecked(new Set(keys));
      setRoleLabel(data.label || role.label || role.name || "");
      setMatrixModal(true);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal memuat permission role");
    }
  };

  const togglePerm = (key) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (grup, selectAll) => {
    const keys = (groupedPerms[grup] || []).map((p) => p.key);
    setChecked((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (selectAll ? next.add(k) : next.delete(k)));
      return next;
    });
  };

  const saveMatrix = async () => {
    if (rbacReadOnly || !selectedRole?.can_manage) return;
    setSavingMatrix(true);
    setError("");
    try {
      await api.put(`/roles/${selectedRole.id}/permissions`, {
        permissions: [...checked],
        label: roleLabel.trim(),
      });
      setMatrixModal(false);
      flash(`Permission role "${selectedRole.label || selectedRole.name}" diperbarui`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan permission");
    } finally {
      setSavingMatrix(false);
    }
  };

  const handleAddRole = async () => {
    if (rbacReadOnly) return;
    if (!newRole.name.trim()) {
      setError("Nama role wajib diisi");
      return;
    }
    setError("");
    try {
      await api.post("/roles", {
        name: newRole.name.trim().toLowerCase().replace(/\s+/g, "_"),
        label: newRole.label.trim() || newRole.name.trim(),
      });
      setAddModal(false);
      setNewRole({ name: "", label: "" });
      flash("Role custom berhasil ditambahkan");
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menambah role");
    }
  };

  const openDelete = (role) => {
    setDeleteTarget(role);
    setDeleteModal(true);
  };

  const handleDelete = async () => {
    if (rbacReadOnly) return;
    setError("");
    try {
      await api.delete(`/roles/${deleteTarget.id}`);
      setDeleteModal(false);
      flash(`Role "${deleteTarget.label || deleteTarget.name}" dihapus`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menghapus role");
    }
  };

  return (
    <AppShell
      title="Role & Hak Akses"
      description={
        rbacReadOnly
          ? "Lihat role bawaan sistem — perubahan matrix hanya via admin platform"
          : "Kelola role dan matrix permission sistem RBAC"
      }
      breadcrumb="Sistem / Role & Hak Akses"
    >
      <LegacyPageStyles />
      {error && <div style={bannerError}>{error}</div>}
      {success && <div style={bannerSuccess}>{success}</div>}

      {rbacReadOnly ? (
        <div style={bannerInfo}>
          Manajemen role dinonaktifkan untuk tenant. Anda hanya dapat melihat role bawaan
          dan assign user ke role yang diizinkan.
        </div>
      ) : null}

      <DataTableCard
          title="Daftar Role"
          subtitle={rbacReadOnly ? "Read-only — role bawaan sistem" : "Kelola role dan permission sistem"}
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {roles.length} role
            </span>
          }
        >
          <TableToolbar
            actions={
              rbacReadOnly ? null : (
                <Button type="button" variant="primary" onClick={() => setAddModal(true)}>
                  + Tambah Role Custom
                </Button>
              )
            }
          />

          {loading ? (
            <EmptyState title="Memuat data..." description="Mohon tunggu sebentar." />
          ) : roles.length === 0 ? (
            <EmptyState
              title="Belum ada role"
              description="Tambahkan role custom untuk memulai."
            />
          ) : (
            <>
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Nama Sistem</th>
                    <th>Tipe</th>
                    <th>Jumlah Permission</th>
                    <th className="table-v3__cell--actions">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((r) => (
                    <tr key={r.id}>
                      <td className="table-v3__cell--strong">{r.label || r.name}</td>
                      <td className="table-v3__cell--mono">{r.name}</td>
                      <td>
                        {r.is_system ? (
                          <StatusBadge status="sistem">Sistem</StatusBadge>
                        ) : (
                          <StatusBadge status="custom">Custom</StatusBadge>
                        )}
                      </td>
                      <td>{r.total_permission || 0}</td>
                      <td className="table-v3__cell--actions">
                        <TableActions
                          items={[
                            {
                              type: "custom",
                              icon: FaCog,
                              title: rbacReadOnly ? "Lihat Permission" : "Edit Permission",
                              onClick: () => openMatrix(r),
                            },
                            {
                              type: "delete",
                              hidden: rbacReadOnly || r.is_system,
                              onClick: () => openDelete(r),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
            <TablePagination
              page={page}
              pageSize={pageSize}
              totalItems={totalItems}
              onPageChange={setPage}
            />
            </>
          )}
        </DataTableCard>
      <Modal
        open={matrixModal}
        title={`${rbacReadOnly ? "Lihat" : "Edit"} Permission Matrix — ${selectedRole?.label || selectedRole?.name || ""}`}
        onClose={() => setMatrixModal(false)}
        width={720}
      >
        <FormGrid columns="modal">
          <FormField label="Nama Internal" htmlFor="role-internal-name">
            <Input id="role-internal-name" value={selectedRole?.name || ""} disabled readOnly />
          </FormField>
          <FormField label="Label Tampilan" htmlFor="role-display-label" required>
            <Input
              id="role-display-label"
              value={roleLabel}
              onChange={(event) => setRoleLabel(event.target.value)}
              disabled={rbacReadOnly || !selectedRole?.can_manage}
            />
          </FormField>
        </FormGrid>
        <p style={{ margin: "0 0 16px", color: "var(--text-secondary)", fontSize: "13px" }}>
          {selectedRole?.is_system
            ? `Role Sistem · identitas internal dan tipe terkunci · ${selectedRole?.permission_source === "tenant_override" ? "override tenant aktif" : "menggunakan fallback global"}`
            : "Role custom tenant"}
          {` · ${checked.size} permission dipilih`}
        </p>

        <div style={{ maxHeight: "55vh", overflowY: "auto", paddingRight: "4px" }}>
          {Object.entries(groupedPerms).map(([grup, perms]) => {
            const allSelected = perms.every((p) => checked.has(p.key));
            const someSelected = perms.some((p) => checked.has(p.key));
            return (
              <div key={grup} style={groupCard}>
                <div style={groupHeader}>
                  <span style={{ fontWeight: 600, textTransform: "capitalize", color: "var(--text-primary)" }}>
                    {grup.replace(/_/g, " ")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleGroup(grup, !allSelected)}
                    disabled={!selectedRole?.can_manage}
                    style={{ border: "none", background: "transparent", padding: "2px 0" }}
                  >
                    {allSelected ? "Hapus semua" : someSelected ? "Pilih semua" : "Pilih semua"}
                  </Button>
                </div>
                <div className="roles-perm-grid">
                  {perms.map((p) => (                    <label key={p.key} style={checkLabel}>
                      <input
                        type="checkbox"
                        checked={checked.has(p.key)}
                        onChange={() => togglePerm(p.key)}
                        disabled={rbacReadOnly || !selectedRole?.can_manage}
                      />
                      <span>
                        <span style={{ display: "block", fontSize: "13px", color: "var(--text-primary)" }}>
                          {p.label || p.key}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{p.key}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <FormActionBar className="form-action-bar-v3--compact">
          {!rbacReadOnly && selectedRole?.can_manage ? (
            <Button
              type="button"
              variant="primary"
              onClick={saveMatrix}
              loading={savingMatrix}
              disabled={savingMatrix}
            >
              Simpan Permission
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => setMatrixModal(false)}>
            Tutup
          </Button>
        </FormActionBar>
      </Modal>

      <Modal open={addModal} title="Tambah Role Custom" onClose={() => setAddModal(false)} width={440}>
        <FormGrid columns="modal">
          <FormField label="Nama Role (slug)" htmlFor="role-name" required>
            <Input
              id="role-name"
              placeholder="contoh: operator_keuangan"
              value={newRole.name}
              onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
            />
          </FormField>
          <FormField label="Label Tampilan" htmlFor="role-label">
            <Input
              id="role-label"
              placeholder="contoh: Operator Keuangan"
              value={newRole.label}
              onChange={(e) => setNewRole({ ...newRole, label: e.target.value })}
            />
          </FormField>
        </FormGrid>
        <FormActionBar className="form-action-bar-v3--compact">
          <Button type="button" variant="primary" onClick={handleAddRole}>
            Simpan Role
          </Button>
          <Button type="button" variant="outline" onClick={() => setAddModal(false)}>
            Batal
          </Button>
        </FormActionBar>
      </Modal>

      <Modal open={deleteModal} title="Hapus Role Custom" onClose={() => setDeleteModal(false)} width={420}>
        <p style={{ margin: "0 0 16px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Hapus role <strong>{deleteTarget?.label || deleteTarget?.name}</strong>?
          User dengan role ini tidak akan bisa di-assign ulang.
        </p>
        <FormActionBar className="form-action-bar-v3--compact">
          <Button type="button" variant="danger" onClick={handleDelete}>
            Ya, Hapus
          </Button>
          <Button type="button" variant="outline" onClick={() => setDeleteModal(false)}>
            Batal
          </Button>
        </FormActionBar>
      </Modal>
    </AppShell>
  );
}

const groupCard = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "14px",
  marginBottom: "12px",
  background: "var(--neutral-subtle)",
};
const groupHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "10px",
};

const checkLabel = {
  display: "flex",
  alignItems: "flex-start",
  gap: "8px",
  cursor: "pointer",
  padding: "6px 4px",
};

const bannerInfo = {
  background: "var(--neutral-subtle)",
  color: "var(--text-secondary)",
  padding: "12px 16px",
  borderRadius: "8px",
  marginBottom: "16px",
  fontSize: "14px",
  borderLeft: "3px solid var(--primary)",
};

const bannerError = {
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  padding: "12px 16px",
  borderRadius: "8px",
  marginBottom: "16px",
  fontSize: "14px",
  borderLeft: "3px solid var(--danger)",
};

const bannerSuccess = {
  background: "var(--success-subtle)",
  color: "var(--primary-hover)",
  padding: "12px 16px",
  borderRadius: "8px",
  marginBottom: "16px",
  fontSize: "14px",
  borderLeft: "3px solid var(--primary-hover)",
};

export default RolesPage;
