import { useEffect, useState } from "react";

import api from "../services/api";

import AppShell from "../layouts/AppShell";

import Card from "../components/ui/Card";

import SectionHeading from "../components/ui/SectionHeading";

import StatusBadge from "../components/ui/StatusBadge";

import Button, { actionBarStyle } from "../components/ui/Button";
import { Table, TableScroll } from "../components/ui/table";
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

      .akademik-filter-panel.filter-bar-v3 {
        margin-bottom: 0;
      }

      .akademik-filter-panel .filter-bar-v3__fields select,
      .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
        min-width: 0;
        flex: 1 1 140px;
        max-width: 220px;
      }

      .absensi-guru-input {
        width: 92px;
        min-height: 36px;
        flex: initial;
        text-align: center;
        box-sizing: border-box;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface);
        color: var(--text-primary);
        padding: 6px 8px;
        font: inherit;
      }

      .absensi-guru-input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--focus-ring);
      }

      @media (max-width: 767px) {
        .akademik-filter-panel .filter-bar-v3__fields select,
        .akademik-filter-panel .filter-bar-v3__fields input[type="number"] {
          flex: 1 1 100%;
          max-width: 100%;
        }
      }
    `}</style>
  );
}



const STATUS_COLUMNS = [

  { key: "total_hadir", label: "Hadir", variant: "success" },

  { key: "total_izin", label: "Izin", variant: "info" },

  { key: "total_sakit", label: "Sakit", variant: "warning" },

  { key: "total_alfa", label: "Alfa", variant: "danger" },

];



function AbsensiGuruPage() {

  const [guru, setGuru] = useState([]);

  const [data, setData] = useState({});

  const [bulan, setBulan] = useState(new Date().getMonth() + 1);

  const [tahun, setTahun] = useState(new Date().getFullYear());



  const getGuru = async () => {

    try {

      const response = await api.get("/guru");

      setGuru(response.data.data || []);

    } catch (err) {

      console.error(err);

    }

  };



  useEffect(() => {

    getGuru();

    getAbsensiGuru();

  }, [bulan, tahun]);



  const handleInput = (guruId, field, value) => {

    setData({

      ...data,

      [guruId]: {

        ...data[guruId],

        [field]: value,

      },

    });

  };



  const simpan = async () => {

    try {

      for (const guruId in data) {

        const d = data[guruId];



        await api.post("/absensi-guru", {

          guru_id: guruId,

          bulan,

          tahun,

          total_hadir: d.total_hadir || 0,

          total_izin: d.total_izin || 0,

          total_sakit: d.total_sakit || 0,

          total_alfa: d.total_alfa || 0,

        });

      }



      alert("Absensi guru berhasil disimpan");

    } catch (err) {

      console.error(err);

      alert("Gagal simpan");

    }

  };



  const getAbsensiGuru = async () => {

    try {

      const response = await api.get("/absensi-guru");



      const obj = {};



      response.data.data.forEach((row) => {

        if (

          Number(row.bulan) === Number(bulan) &&

          Number(row.tahun) === Number(tahun)

        ) {

          obj[row.guru_id] = {

            total_hadir: row.total_hadir,

            total_izin: row.total_izin,

            total_sakit: row.total_sakit,

            total_alfa: row.total_alfa,

          };

        }

      });



      setData(obj);

    } catch (err) {

      console.error(err);

    }

  };



  return (

    <AppShell title="Absensi Guru" breadcrumb="Akademik / Absensi Guru">

      <AkademikResponsiveStyles />

      <div className="akademik-page">

      <Card padding="md" shadow="card" border={false} radius="xl">

        <div className="akademik-filter-panel ops-page__filter filter-bar-v3 filter-bar-v3--table">
          <span className="filter-bar-v3__label">Filter absensi guru</span>
          <div className="filter-bar-v3__fields" style={filterPanelStyle}>
            <select
              className="form-select-v3"
              value={bulan}
              onChange={(e) => setBulan(e.target.value)}
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
              onChange={(e) => setTahun(e.target.value)}
              aria-label="Tahun"
            />
          </div>
        </div>

      </Card>



      <div style={{ marginTop: "var(--space-6)" }}>

        <Card padding="md" shadow="card" border={false} radius="xl">

          <SectionHeading variant="eyebrow" spacing="first">

            Rekap Absensi Guru

          </SectionHeading>



          <div style={{ marginTop: "var(--space-4)" }}>
          <TableScroll matrix sticky>
          <Table>
            <thead>
              <tr>
                <th className="table-v3__col--sticky">Nama Guru</th>
                <th>Jabatan</th>
                {STATUS_COLUMNS.map((col) => (
                  <th key={col.key}>
                    <StatusBadge status={col.label} size="sm" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guru.map((g) => (
                <tr key={g.id}>
                  <td className="table-v3__col--sticky table-v3__cell--strong">{g.nama}</td>
                  <td>{g.jabatan}</td>
                  {STATUS_COLUMNS.map((col) => (
                    <td key={col.key}>
                      <input
                        className="absensi-guru-input"
                        type="number"
                        value={data[g.id]?.[col.key] || ""}
                        onChange={(e) =>
                          handleInput(g.id, col.key, e.target.value)
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          </TableScroll>
          </div>



          <div style={{ ...actionBarStyle, marginTop: "var(--space-4)" }}>

            <Button variant="primary" onClick={simpan}>Simpan Absensi Guru</Button>

          </div>

        </Card>

      </div>

      </div>

    </AppShell>

  );

}



export default AbsensiGuruPage;

