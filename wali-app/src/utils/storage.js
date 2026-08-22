import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  TOKEN: 'wali_token',
  WALI: 'wali_data',
  ANAK: 'wali_anak',
  SANTRI_IDS: 'wali_santri_ids',
  ACTIVE_SANTRI: 'active_santri_id',
  ACTIVE_UNIT: 'active_unit_id',
  TENANT_SLUG: 'wali_tenant_slug',
  PESANTREN_BRANDING: 'pesantren_branding',
  PUSH_STATUS: 'wali_push_registration_status',
};

const SECURE_TOKEN_KEY = 'wali.auth_token';
const SECURE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function requireSecureStore() {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('Penyimpanan aman tidak tersedia pada perangkat ini.');
  }
}

export const storage = {
  async setToken(token) {
    await requireSecureStore();
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, String(token), SECURE_OPTIONS);
    await AsyncStorage.removeItem(KEYS.TOKEN);
  },

  async saveSession(token, wali, anak, santriIds, tenantSlug) {
    await requireSecureStore();
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, String(token), SECURE_OPTIONS);

    const pairs = tenantSlug ? [[KEYS.TENANT_SLUG, tenantSlug]] : [];
    if (pairs.length > 0) await AsyncStorage.multiSet(pairs);

    // Remove legacy plaintext session payloads after the secure write succeeds.
    await AsyncStorage.multiRemove([KEYS.TOKEN, KEYS.WALI, KEYS.ANAK, KEYS.SANTRI_IDS]);
  },

  async getToken() {
    await requireSecureStore();
    const secureToken = await SecureStore.getItemAsync(SECURE_TOKEN_KEY, SECURE_OPTIONS);
    if (secureToken) return secureToken;

    // One-time, fail-safe migration from releases that used AsyncStorage.
    const legacyToken = await AsyncStorage.getItem(KEYS.TOKEN);
    if (!legacyToken) return null;
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, legacyToken, SECURE_OPTIONS);
    await AsyncStorage.removeItem(KEYS.TOKEN);
    return legacyToken;
  },

  async getActiveSantriId() {
    const raw = await AsyncStorage.getItem(KEYS.ACTIVE_SANTRI);
    const parsed = raw ? Number(raw) : null;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  },

  async setActiveSantriId(id) {
    await AsyncStorage.setItem(KEYS.ACTIVE_SANTRI, String(id));
  },

  async getActiveUnitId() {
    const raw = await AsyncStorage.getItem(KEYS.ACTIVE_UNIT);
    const parsed = raw ? Number(raw) : null;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  },

  async setActiveUnitId(id) {
    await AsyncStorage.setItem(KEYS.ACTIVE_UNIT, String(id));
  },

  async getTenantSlug() {
    const slug = await AsyncStorage.getItem(KEYS.TENANT_SLUG);
    return slug || 'default';
  },

  async setTenantSlug(slug) {
    if (slug) {
      await AsyncStorage.setItem(KEYS.TENANT_SLUG, slug);
    }
  },

  async clearSession() {
    await Promise.allSettled([
      SecureStore.deleteItemAsync(SECURE_TOKEN_KEY, SECURE_OPTIONS),
      AsyncStorage.multiRemove([
      KEYS.TOKEN,
      KEYS.WALI,
      KEYS.ANAK,
      KEYS.SANTRI_IDS,
      KEYS.ACTIVE_SANTRI,
      KEYS.ACTIVE_UNIT,
      KEYS.TENANT_SLUG,
      KEYS.PESANTREN_BRANDING,
      KEYS.PUSH_STATUS,
      ]),
    ]);
  },

  async savePesantrenBranding(profil) {
    const payload = {
      nama_pesantren: profil.nama_pesantren,
      logo_url: profil.logo_url ?? null,
      splash_logo_url: profil.splash_logo_url ?? null,
      app_icon_url: profil.app_icon_url ?? null,
      tagline: profil.tagline ?? null,
      alamat: profil.alamat ?? null,
      banner_url: profil.banner_url ?? null,
      banner_active: profil.banner_active !== false,
      tentang: profil.tentang ?? null,
      updated_at: profil.updated_at ?? null,
    };
    await AsyncStorage.setItem(KEYS.PESANTREN_BRANDING, JSON.stringify(payload));
  },

  async getPesantrenBranding() {
    const raw = await AsyncStorage.getItem(KEYS.PESANTREN_BRANDING);
    return safeJsonParse(raw, null);
  },
};
