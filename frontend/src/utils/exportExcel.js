import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// ======================
// EXPORT EXCEL UNIVERSAL
// ======================

export const exportExcel = (
  data,
  fileName,
  { summary = null } = {},
) => {

  if (
    !data ||
    data.length === 0
  ) {

    alert(
      "Tidak ada data untuk diexport"
    );

    return;

  }

  const worksheet =
    XLSX.utils.json_to_sheet(
      data
    );

  const workbook =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(

    workbook,

    worksheet,

    "Data"

  );

  if (summary && summary.length > 0) {
    const summaryWorksheet = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, "Ringkasan");
  }

  const excelBuffer =
    XLSX.write(

      workbook,

      {

        bookType: "xlsx",

        type: "array"

      }

    );

  const fileData =
    new Blob(

      [excelBuffer],

      {

        type:

          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8"

      }

    );

  const today =

    new Date()

      .toISOString()

      .split("T")[0];

  saveAs(

    fileData,

    `${fileName}_${today}.xlsx`

  );

};
