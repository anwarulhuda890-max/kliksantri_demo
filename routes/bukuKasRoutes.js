const express = require("express");
const router = express.Router();
const {
  deleteBukuKas,
  handleServiceError,
  listBukuKas,
  writeBukuKas,
} = require("../services/financeCashService");

router.get("/", async (req, res) => {
  try {
    const result = await listBukuKas(req);
    res.json({ success: true, ...result });
  } catch (err) {
    handleServiceError(res, err, "Gagal memuat Buku Kas");
  }
});

router.post("/", async (req, res) => {
  try {
    const data = await writeBukuKas(req);
    res.json({ success: true, data });
  } catch (err) {
    handleServiceError(res, err, "Gagal menyimpan Buku Kas");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const data = await writeBukuKas(req, { id: req.params.id });
    res.json({ success: true, data });
  } catch (err) {
    handleServiceError(res, err, "Gagal memperbarui Buku Kas");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deleteBukuKas(req, req.params.id);
    res.json({ success: true });
  } catch (err) {
    handleServiceError(res, err, "Gagal menghapus Buku Kas");
  }
});

module.exports = router;
