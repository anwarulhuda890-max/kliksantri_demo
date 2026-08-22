const { Expo } = require("expo-server-sdk");
const pool = require("../db");
const pushNotificationService = require("./pushNotificationService");

const expo = new Expo();

const LOG_STATUS = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
};

const ALLOWED_PLATFORMS = new Set(["android", "ios", "web"]);

function normalizePlatform(platform) {
  if (!platform) return null;
  const value = String(platform).trim().toLowerCase();
  return ALLOWED_PLATFORMS.has(value) ? value : null;
}

async function createInAppNotification({
  tenantId,
  waliAkunId,
  santriId = null,
  title,
  body,
  type = "generic",
  data = {},
}) {
  const safeTitle = String(title || "").trim();
  const safeBody = String(body || "").trim();

  if (!tenantId || !waliAkunId) {
    throw new Error("tenantId dan waliAkunId wajib");
  }

  if (!safeTitle || !safeBody) {
    const err = new Error("title dan body wajib");
    err.statusCode = 400;
    throw err;
  }

  const result = await pool.query(
    `
    INSERT INTO wali_in_app_notifications (
      tenant_id,
      wali_akun_id,
      santri_id,
      title,
      body,
      type,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    RETURNING *
    `,
    [
      tenantId,
      waliAkunId,
      santriId ? Number(santriId) : null,
      safeTitle,
      safeBody,
      type,
      JSON.stringify(data || {}),
    ]
  );

  const notification = result.rows[0];

  try {
    await pushNotificationService.sendPushToWali({
      tenantId,
      waliId: waliAkunId,
      title: safeTitle,
      body: safeBody,
      data: {
        ...(data || {}),
        type,
        notification_id: notification.id,
      },
    });
  } catch (pushErr) {
    console.log("IN-APP PUSH ERROR:", pushErr.message);
  }

  return notification;
}

async function sendInAppToWaliBySantriId({
  tenantId,
  santriId,
  title,
  body = null,
  type = "generic",
  data = {},
}) {
  try {
    if (!tenantId || !santriId) {
      return {
        success: false,
        skipped: true,
        reason: "missing_tenant_or_santri",
      };
    }

    const waliRows = await resolveWaliAccountsForSantri(tenantId, santriId);

    if (waliRows.length === 0) {
      return {
        success: false,
        skipped: true,
        reason: "no_wali",
      };
    }

    const santriNama = waliRows[0].santri_nama || "Anak";
    const safeTitle = String(title || "").trim();
    const defaultBodyByType = {
      pelanggaran: `[${santriNama}] mendapatkan pelanggaran baru.`,
      perizinan: `[${santriNama}] tercatat keluar pondok.`,
      kesehatan: `[${santriNama}] sedang tercatat sakit.`,
      sahriyah: `[${santriNama}] ada pembaruan sahriyah.`,
      pembayaran: `[${santriNama}] pembayaran telah diterima.`,
    };
    const safeBody =
      String(body || "").trim() ||
      defaultBodyByType[type] ||
      `[${santriNama}] ada pembaruan.`;

    const payload = {
      ...(data || {}),
      type,
      santri_id: Number(santriId),
    };

    const rows = [];
    const seenWali = new Set();

    for (const row of waliRows) {
      if (seenWali.has(row.wali_akun_id)) continue;
      seenWali.add(row.wali_akun_id);

      const notification = await createInAppNotification({
        tenantId,
        waliAkunId: row.wali_akun_id,
        santriId,
        title: safeTitle,
        body: safeBody,
        type,
        data: payload,
      });

      rows.push(notification);
    }

    return {
      success: rows.length > 0,
      count: rows.length,
      rows,
    };
  } catch (err) {
    console.log("sendInAppToWaliBySantriId ERROR:", err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

async function sendInAppToAllWaliInTenant({
  tenantId,
  title,
  body,
  type = "generic",
  data = {},
}) {
  try {
    if (!tenantId) {
      return {
        success: false,
        skipped: true,
        reason: "missing_tenant",
      };
    }

    const waliRows = await getActiveWaliAccountsInTenant(tenantId);

    if (waliRows.length === 0) {
      return {
        success: false,
        skipped: true,
        reason: "no_wali",
      };
    }

    const safeTitle = String(title || "").trim();
    const safeBody = String(body || "").trim();

    if (!safeTitle || !safeBody) {
      return {
        success: false,
        skipped: true,
        reason: "missing_title_or_body",
      };
    }

    const payload = {
      ...(data || {}),
      type,
    };

    const rows = [];

    for (const row of waliRows) {
      const notification = await createInAppNotification({
        tenantId,
        waliAkunId: row.wali_akun_id,
        title: safeTitle,
        body: safeBody,
        type,
        data: payload,
      });

      rows.push(notification);
    }

    return {
      success: rows.length > 0,
      count: rows.length,
      rows,
    };
  } catch (err) {
    console.log("sendInAppToAllWaliInTenant ERROR:", err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

async function sendInAppToWaliInUnit({
  tenantId,
  unitId,
  title,
  body,
  type = "generic",
  data = {},
}) {
  try {
    const { rows: waliRows } = await pool.query(
      `SELECT DISTINCT wa.id AS wali_akun_id
       FROM wali_akun wa
       JOIN wali_santri ws
         ON ws.tenant_id = wa.tenant_id AND ws.nomor_hp = wa.nomor_hp
       JOIN santri_units su
         ON su.tenant_id = ws.tenant_id AND su.santri_id = ws.santri_id
        AND su.status = 'active' AND su.left_at IS NULL
       WHERE wa.tenant_id = $1
         AND wa.status = 'active'
         AND su.unit_id = $2
       ORDER BY wa.id`,
      [tenantId, unitId],
    );

    const safeTitle = String(title || "").trim();
    const safeBody = String(body || "").trim();
    if (!safeTitle || !safeBody) {
      return { success: false, skipped: true, reason: "missing_title_or_body" };
    }

    const rows = [];
    for (const row of waliRows) {
      rows.push(await createInAppNotification({
        tenantId,
        waliAkunId: row.wali_akun_id,
        title: safeTitle,
        body: safeBody,
        type,
        data: { ...(data || {}), type, unit_id: Number(unitId) },
      }));
    }
    return { success: rows.length > 0, count: rows.length, rows };
  } catch (err) {
    console.log("sendInAppToWaliInUnit ERROR:", err.message);
    return { success: false, error: err.message };
  }
}

async function listInAppNotifications({
  tenantId,
  waliAkunId,
  limit = 30,
  offset = 0,
  unreadOnly = false,
}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const conditions = ["tenant_id = $1", "wali_akun_id = $2"];
  const params = [tenantId, waliAkunId];

  if (unreadOnly) {
    conditions.push("read_at IS NULL");
  }

  const whereSql = conditions.join(" AND ");

  const [countResult, unreadResult, dataResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM wali_in_app_notifications
       WHERE ${whereSql}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM wali_in_app_notifications
       WHERE tenant_id = $1
         AND wali_akun_id = $2
         AND read_at IS NULL`,
      [tenantId, waliAkunId]
    ),
    pool.query(
      `
      SELECT
        id,
        santri_id,
        title,
        body,
        type,
        data,
        read_at,
        created_at
      FROM wali_in_app_notifications
      WHERE ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, safeLimit, safeOffset]
    ),
  ]);

  return {
    data: dataResult.rows,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total: countResult.rows[0]?.total || 0,
    },
    unread_count: unreadResult.rows[0]?.total || 0,
  };
}

async function markInAppNotificationRead({
  tenantId,
  waliAkunId,
  notificationId,
}) {
  const result = await pool.query(
    `
    UPDATE wali_in_app_notifications
    SET read_at = COALESCE(read_at, NOW())
    WHERE id = $1
      AND tenant_id = $2
      AND wali_akun_id = $3
    RETURNING
      id,
      santri_id,
      title,
      body,
      type,
      data,
      read_at,
      created_at
    `,
    [notificationId, tenantId, waliAkunId]
  );

  return result.rows[0] || null;
}

async function markAllInAppNotificationsRead({ tenantId, waliAkunId }) {
  const result = await pool.query(
    `
    UPDATE wali_in_app_notifications
    SET read_at = COALESCE(read_at, NOW())
    WHERE tenant_id = $1
      AND wali_akun_id = $2
      AND read_at IS NULL
    RETURNING id
    `,
    [tenantId, waliAkunId]
  );

  return result.rowCount;
}

async function registerPushToken({
  tenantId,
  waliAkunId,
  expoPushToken,
  deviceId = null,
  platform = null,
}) {
  if (!tenantId || !waliAkunId) {
    throw new Error("tenantId dan waliAkunId wajib");
  }

  const token = String(expoPushToken || "").trim();
  if (!Expo.isExpoPushToken(token)) {
    const err = new Error("expo_push_token tidak valid");
    err.statusCode = 400;
    throw err;
  }

  const akunCheck = await pool.query(
    `SELECT id FROM wali_akun
     WHERE id = $1 AND tenant_id = $2
     LIMIT 1`,
    [waliAkunId, tenantId]
  );

  if (akunCheck.rows.length === 0) {
    const err = new Error("Akun wali tidak ditemukan di tenant ini");
    err.statusCode = 403;
    throw err;
  }

  const result = await pool.query(
    `
    INSERT INTO wali_push_tokens (
      tenant_id,
      wali_akun_id,
      expo_push_token,
      device_id,
      platform,
      is_active,
      last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, true, NOW())
    ON CONFLICT (tenant_id, expo_push_token)
    DO UPDATE SET
      wali_akun_id = EXCLUDED.wali_akun_id,
      device_id = COALESCE(EXCLUDED.device_id, wali_push_tokens.device_id),
      platform = COALESCE(EXCLUDED.platform, wali_push_tokens.platform),
      is_active = true,
      last_seen_at = NOW()
    RETURNING *
    `,
    [
      tenantId,
      waliAkunId,
      token,
      deviceId ? String(deviceId).slice(0, 128) : null,
      normalizePlatform(platform),
    ]
  );

  return result.rows[0];
}

async function createNotificationLog({
  tenantId,
  waliAkunId,
  title,
  body,
  type = "generic",
  data = {},
  status = LOG_STATUS.PENDING,
  provider = "expo",
  providerTicketId = null,
  errorMessage = null,
}) {
  const result = await pool.query(
    `
    INSERT INTO notification_logs (
      tenant_id,
      wali_akun_id,
      title,
      body,
      type,
      data,
      status,
      provider,
      provider_ticket_id,
      error_message
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
    RETURNING *
    `,
    [
      tenantId,
      waliAkunId,
      title,
      body,
      type,
      JSON.stringify(data || {}),
      status,
      provider,
      providerTicketId,
      errorMessage,
    ]
  );

  return result.rows[0];
}

async function updateNotificationLog(logId, tenantId, patch) {
  const result = await pool.query(
    `
    UPDATE notification_logs
    SET
      status = COALESCE($3, status),
      provider_ticket_id = COALESCE($4, provider_ticket_id),
      error_message = COALESCE($5, error_message)
    WHERE id = $1 AND tenant_id = $2
    RETURNING *
    `,
    [
      logId,
      tenantId,
      patch.status ?? null,
      patch.providerTicketId ?? null,
      patch.errorMessage ?? null,
    ]
  );

  return result.rows[0] ?? null;
}

async function deactivateInvalidToken(expoPushToken, tenantId) {
  if (!expoPushToken || !tenantId) return null;

  const result = await pool.query(
    `
    UPDATE wali_push_tokens
    SET is_active = false
    WHERE tenant_id = $1
      AND expo_push_token = $2
    RETURNING id, expo_push_token
    `,
    [tenantId, expoPushToken]
  );

  return result.rows[0] ?? null;
}

async function getActiveTokensForWali(tenantId, waliAkunId) {
  const result = await pool.query(
    `
    SELECT id, expo_push_token, platform, device_id
    FROM wali_push_tokens
    WHERE tenant_id = $1
      AND wali_akun_id = $2
      AND is_active = true
    ORDER BY last_seen_at DESC
    `,
    [tenantId, waliAkunId]
  );

  return result.rows;
}

async function sendPushNotification({
  tenantId,
  waliAkunId,
  title,
  body,
  type = "generic",
  data = {},
}) {
  const safeTitle = String(title || "").trim();
  const safeBody = String(body || "").trim();

  if (!safeTitle || !safeBody) {
    const err = new Error("title dan body wajib");
    err.statusCode = 400;
    throw err;
  }

  const log = await createNotificationLog({
    tenantId,
    waliAkunId,
    title: safeTitle,
    body: safeBody,
    type,
    data,
    status: LOG_STATUS.PENDING,
  });

  const tokenRows = await getActiveTokensForWali(tenantId, waliAkunId);
  const validTokens = tokenRows
    .map((row) => row.expo_push_token)
    .filter((token) => Expo.isExpoPushToken(token));

  if (validTokens.length === 0) {
    await updateNotificationLog(log.id, tenantId, {
      status: LOG_STATUS.FAILED,
      errorMessage: "Tidak ada push token aktif",
    });

    return {
      success: false,
      log_id: log.id,
      sent: 0,
      error: "Tidak ada push token aktif",
    };
  }

  const messages = validTokens.map((pushToken) => ({
    to: pushToken,
    sound: "default",
    title: safeTitle,
    body: safeBody,
    data: {
      ...(data || {}),
      type,
      tenant_id: tenantId,
      wali_akun_id: waliAkunId,
    },
  }));

  const tickets = [];
  const ticketErrors = [];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }
  } catch (err) {
    await updateNotificationLog(log.id, tenantId, {
      status: LOG_STATUS.FAILED,
      errorMessage: err.message,
    });

    return {
      success: false,
      log_id: log.id,
      sent: 0,
      error: err.message,
    };
  }

  let sent = 0;
  let firstTicketId = null;

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const pushToken = validTokens[i];

    if (ticket.status === "ok") {
      sent += 1;
      if (!firstTicketId) firstTicketId = ticket.id;
      continue;
    }

    ticketErrors.push(ticket.message || "Push ticket error");

    if (ticket.details?.error === "DeviceNotRegistered") {
      await deactivateInvalidToken(pushToken, tenantId);
    }
  }

  const finalStatus =
    sent > 0 ? LOG_STATUS.SENT : LOG_STATUS.FAILED;

  await updateNotificationLog(log.id, tenantId, {
    status: finalStatus,
    providerTicketId: firstTicketId,
    errorMessage:
      sent > 0
        ? ticketErrors.length > 0
          ? ticketErrors.join("; ")
          : null
        : ticketErrors.join("; ") || "Gagal mengirim push notification",
  });

  return {
    success: sent > 0,
    log_id: log.id,
    sent,
    tickets,
    errors: ticketErrors,
  };
}

function isTestNotificationAllowed() {
  if (process.env.ALLOW_WALI_TEST_NOTIFICATION === "true") return true;
  return process.env.NODE_ENV !== "production";
}

async function resolveWaliAccountsForSantri(tenantId, santriId) {
  const result = await pool.query(
    `
    SELECT DISTINCT
      wa.id AS wali_akun_id,
      s.nama AS santri_nama
    FROM wali_santri ws
    INNER JOIN wali_akun wa
      ON wa.nomor_hp = ws.nomor_hp
     AND wa.tenant_id = ws.tenant_id
    INNER JOIN santri s
      ON s.id = ws.santri_id
     AND s.tenant_id = ws.tenant_id
    WHERE ws.santri_id = $1
      AND ws.tenant_id = $2
      AND wa.status = 'active'
    ORDER BY wa.id ASC
    `,
    [santriId, tenantId]
  );

  return result.rows;
}

async function sendPushToWaliBySantriId({
  tenantId,
  santriId,
  title,
  body = null,
  type = "generic",
  data = {},
}) {
  try {
    if (!tenantId || !santriId) {
      return {
        success: false,
        skipped: true,
        reason: "missing_tenant_or_santri",
      };
    }

    const waliRows = await resolveWaliAccountsForSantri(
      tenantId,
      santriId
    );

    if (waliRows.length === 0) {
      return {
        success: false,
        skipped: true,
        reason: "no_wali",
      };
    }

    const santriNama =
      waliRows[0].santri_nama || "Anak";

    const safeTitle = String(title || "").trim();
    const defaultBodyByType = {
      pelanggaran: `[${santriNama}] mendapatkan pelanggaran baru.`,
      perizinan: `[${santriNama}] tercatat keluar pondok.`,
      kesehatan: `[${santriNama}] sedang tercatat sakit.`,
    };
    const safeBody =
      String(body || "").trim() ||
      defaultBodyByType[type] ||
      `[${santriNama}] ada pembaruan.`;

    const payload = {
      ...(data || {}),
      type,
      santri_id: Number(santriId),
    };

    const results = [];
    const seenWali = new Set();

    for (const row of waliRows) {
      if (seenWali.has(row.wali_akun_id)) continue;
      seenWali.add(row.wali_akun_id);

      const result = await sendPushNotification({
        tenantId,
        waliAkunId: row.wali_akun_id,
        title: safeTitle,
        body: safeBody,
        type,
        data: payload,
      });

      results.push(result);
    }

    return {
      success: results.some((item) => item.success),
      results,
    };
  } catch (err) {
    console.log("sendPushToWaliBySantriId ERROR:", err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

async function getActiveWaliAccountsInTenant(tenantId) {
  const result = await pool.query(
    `
    SELECT id AS wali_akun_id
    FROM wali_akun
    WHERE tenant_id = $1
      AND status = 'active'
    ORDER BY id ASC
    `,
    [tenantId]
  );

  return result.rows;
}

async function sendPushToAllWaliInTenant({
  tenantId,
  title,
  body,
  type = "generic",
  data = {},
}) {
  try {
    if (!tenantId) {
      return {
        success: false,
        skipped: true,
        reason: "missing_tenant",
      };
    }

    const waliRows = await getActiveWaliAccountsInTenant(tenantId);

    if (waliRows.length === 0) {
      return {
        success: false,
        skipped: true,
        reason: "no_wali",
      };
    }

    const safeTitle = String(title || "").trim();
    const safeBody = String(body || "").trim();

    if (!safeTitle || !safeBody) {
      return {
        success: false,
        skipped: true,
        reason: "missing_title_or_body",
      };
    }

    const payload = {
      ...(data || {}),
      type,
    };

    const results = [];

    for (const row of waliRows) {
      const result = await sendPushNotification({
        tenantId,
        waliAkunId: row.wali_akun_id,
        title: safeTitle,
        body: safeBody,
        type,
        data: payload,
      });

      results.push(result);
    }

    return {
      success: results.some((item) => item.success || item.log_id),
      sent: results.filter((item) => item.success).length,
      results,
    };
  } catch (err) {
    console.log("sendPushToAllWaliInTenant ERROR:", err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

module.exports = {
  LOG_STATUS,
  registerPushToken,
  sendPushNotification,
  sendPushToWaliBySantriId,
  sendPushToAllWaliInTenant,
  createInAppNotification,
  sendInAppToWaliBySantriId,
  sendInAppToAllWaliInTenant,
  sendInAppToWaliInUnit,
  listInAppNotifications,
  markInAppNotificationRead,
  markAllInAppNotificationsRead,
  resolveWaliAccountsForSantri,
  getActiveWaliAccountsInTenant,
  deactivateInvalidToken,
  createNotificationLog,
  getActiveTokensForWali,
  isTestNotificationAllowed,
};
