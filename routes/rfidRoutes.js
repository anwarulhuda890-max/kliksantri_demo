const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const requireTenantFeature = require("../middleware/requireTenantFeature");
const requireUnitFeature = require("../middleware/requireUnitFeature");
const deviceAuthMiddleware = require("../middleware/deviceAuthMiddleware");
const rfidController = require("../controllers/rfidController");
const walletController = require("../controllers/walletController");
const requireWalletFeature = requireTenantFeature.requireAnyTenantFeature(["wallet", "rfid"]);

const adminWalletView = [
  authMiddleware,
  tenantMiddleware,
  requireWalletFeature,
  requireUnitFeature("wallet"),
  requirePermission.requireAnyPermission(["wallet.view", "rfid.view"]),
];

const adminWalletManage = [
  authMiddleware,
  tenantMiddleware,
  requireWalletFeature,
  requireUnitFeature("wallet"),
  requirePermission.requireAnyPermission(["wallet.manage", "rfid.manage"]),
];

const adminRfidManage = [
  authMiddleware,
  tenantMiddleware,
  requireTenantFeature("rfid"),
  requireUnitFeature("rfid"),
  requirePermission("rfid.manage"),
];

router.get("/dashboard", ...adminWalletView, rfidController.getDashboard);
router.get("/dashboard-summary", ...adminWalletView, rfidController.getDashboardSummary);

router.post("/card/lookup", deviceAuthMiddleware, requireTenantFeature("rfid"), rfidController.lookupCard);
router.post("/payment", deviceAuthMiddleware, requireTenantFeature("rfid"), rfidController.rfidPayment);

router.get("/transactions", ...adminWalletView, rfidController.getTransactions);
router.get("/transactions/export", ...adminWalletView, rfidController.exportTransactions);
router.patch("/transactions/:id", ...adminWalletManage, walletController.editManualTopup);
router.delete("/transactions/:id", ...adminWalletManage, walletController.deleteManualTopup);
router.get("/santri/search", ...adminWalletView, rfidController.searchSantri);

router.post("/topup", ...adminWalletManage, rfidController.topupSaldo);
router.post("/withdrawal", ...adminWalletManage, walletController.withdrawSaldo);
router.get("/topup/export", ...adminWalletView, rfidController.exportTopup);
router.post("/refund", ...adminRfidManage, rfidController.refundTransaction);
router.get("/mutasi", ...adminWalletView, rfidController.getMutasi);

module.exports = router;
