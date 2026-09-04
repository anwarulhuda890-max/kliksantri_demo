import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useAuth } from '../../context/AuthContext';
import { useActiveChild } from '../../context/ActiveChildContext';
import { BrandLogo } from '../../components/branding/BrandLogo';
import {
  ScreenContainer,
  AppCard,
  AppButton,
  AppText,
} from '../../components/ui';
import { colors } from '../../constants/colors';
import { interaction, radius, spacing } from '../../constants/theme';
import { storage } from '../../utils/storage';
import { TENANT_INACTIVE_MESSAGE } from '../../constants/tenant';
import {
  resolveBrandingName,
  resolveBrandingTagline,
  resolveLoginLogoUrl,
} from '../../utils/branding';
import { BUILD_BRAND, IS_WHITE_LABEL } from '../../config/buildBrand';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const DEFAULT_TAGLINE = 'Portal Wali Santri';

function LoginField({ label, children, error }) {
  return (
    <View style={styles.field}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      {children}
      {error ? (
        <AppText variant="caption" color="danger" style={styles.fieldError}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

export function LoginScreen() {
  usePreventScreenCapture('wali-login');
  const { login } = useAuth();
  const { setActiveSantri } = useActiveChild();

  const [nomorHp, setNomorHp] = useState('');
  const [tenantSlug, setTenantSlug] = useState('default');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [branding, setBranding] = useState(null);

  const pinRef = useRef(null);
  const loginInFlightRef = useRef(false);

  useEffect(() => {
    if (!IS_WHITE_LABEL) {
      storage.getPesantrenBranding().then(setBranding).catch(() => {});
      storage.getTenantSlug().then((slug) => {
        if (slug) setTenantSlug(slug);
      }).catch(() => {});
    }
  }, []);

  const namaPesantren = IS_WHITE_LABEL ? BUILD_BRAND.appName : (branding ? resolveBrandingName(branding) : BUILD_BRAND.appName);
  const tagline = IS_WHITE_LABEL ? BUILD_BRAND.slogan : (branding ? resolveBrandingTagline(branding, BUILD_BRAND.slogan || DEFAULT_TAGLINE) : BUILD_BRAND.slogan);
  const loginLogo = IS_WHITE_LABEL ? BUILD_BRAND.logoUrl : resolveLoginLogoUrl(branding);

  function handlePhoneChange(text) {
    setNomorHp(text.replace(/[^0-9]/g, ''));
    setError('');
  }

  function handlePinChange(text) {
    setPin(text.replace(/[^0-9]/g, '').slice(0, 6));
    setError('');
  }

  async function handleLogin() {
    if (loginInFlightRef.current) return;
    setError('');

    if (!nomorHp || nomorHp.length < 9) {
      setError('Masukkan nomor HP yang valid.');
      return;
    }
    if (!pin || pin.length < 6) {
      setError('PIN harus 6 digit.');
      return;
    }

    if (!IS_WHITE_LABEL && (!tenantSlug || tenantSlug.trim().length < 2)) {
      setError('Masukkan kode pesantren yang valid.');
      return;
    }

    loginInFlightRef.current = true;
    setIsLoading(true);
    try {
      const slug = IS_WHITE_LABEL ? (BUILD_BRAND.tenantSlug || '') : tenantSlug.trim().toLowerCase();
      if (!IS_WHITE_LABEL) await storage.setTenantSlug(slug);
      const { anak } = await login(nomorHp, pin, slug);

      await setActiveSantri(anak[0]);
    } catch (err) {
      const status = err.response?.status;
      setPin('');

      if (err.code === 'NO_CHILDREN') {
        setError('Akun ini belum memiliki santri aktif. Hubungi admin pesantren.');
      } else if (status === 423) {
        setError('Akun terkunci sementara. Hubungi admin pesantren.');
      } else if (status === 403) {
        const isTenantInactive = err.response?.data?.error === TENANT_INACTIVE_MESSAGE;
        setError(isTenantInactive ? TENANT_INACTIVE_MESSAGE : 'Akun atau layanan sedang tidak aktif. Hubungi admin pesantren.');
      } else if (status === 404) {
        setError('Kode pesantren tidak ditemukan.');
      } else if (status === 401 || status === 400) {
        setError('Nomor HP atau PIN salah.');
      } else if (status === 429) {
        setError('Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.');
      } else if (status >= 500) {
        setError('Layanan sedang mengalami gangguan. Silakan coba lagi nanti.');
      } else if (err.code === 'ECONNABORTED') {
        setError('Koneksi terlalu lama. Silakan coba lagi.');
      } else if (err.code === 'ERR_NETWORK' || !err.response) {
        setError('Tidak dapat terhubung. Periksa koneksi internet Anda lalu coba lagi.');
      } else {
        setError('Tidak dapat masuk saat ini. Silakan coba lagi.');
      }
    } finally {
      loginInFlightRef.current = false;
      setIsLoading(false);
    }
  }

  return (
    <ScreenContainer style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <BrandLogo logoUrl={loginLogo} nama={namaPesantren} size={72} />
            <AppText variant="display" color="inverse" style={styles.heroTitle} numberOfLines={2}>
              {namaPesantren}
            </AppText>
            <AppText variant="body" color="inverse" style={styles.heroTagline}>
              {tagline}
            </AppText>
          </View>

          <AppCard padding="lg" shadow="md" style={styles.formCard}>
            <AppText variant="h2" style={styles.formTitle}>
              Masuk ke Akun Anda
            </AppText>

            {error ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <AppText variant="caption" color="danger" style={styles.errorText}>
                  {error}
                </AppText>
              </View>
            ) : null}

            {!IS_WHITE_LABEL ? <LoginField label="Kode Pesantren">
              <TextInput
                style={styles.input}
                placeholder="Contoh: default"
                placeholderTextColor={colors.textMuted}
                value={tenantSlug}
                onChangeText={(text) => {
                  setTenantSlug(text.replace(/\s/g, '').toLowerCase());
                  setError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Kode pesantren"
              />
            </LoginField> : null}

            <LoginField label="Nomor HP">
              <TextInput
                style={styles.input}
                placeholder="Contoh: 08123456789"
                placeholderTextColor={colors.textMuted}
                value={nomorHp}
                onChangeText={handlePhoneChange}
                keyboardType="phone-pad"
                returnKeyType="next"
                onSubmitEditing={() => pinRef.current?.focus()}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="tel"
                accessibilityLabel="Nomor HP wali"
              />
            </LoginField>

            <LoginField label="PIN (6 digit)">
              <View style={styles.pinWrap}>
                <TextInput
                  ref={pinRef}
                  style={[styles.input, styles.pinInput]}
                  placeholder="••••••"
                  placeholderTextColor={colors.textMuted}
                  value={pin}
                  onChangeText={handlePinChange}
                  keyboardType="number-pad"
                  secureTextEntry={!showPin}
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  autoComplete="off"
                  importantForAutofill="no"
                  accessibilityLabel="PIN enam digit"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPin((v) => !v)}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                >
                  <Ionicons
                    name={showPin ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>
            </LoginField>

            <AppButton
              fullWidth
              size="lg"
              loading={isLoading}
              disabled={isLoading}
              onPress={handleLogin}
              style={styles.loginBtn}
            >
              Masuk
            </AppButton>

            <View style={styles.forgotRow}>
              <AppText variant="caption" color="secondary">
                Lupa PIN?{' '}
              </AppText>
              <TouchableOpacity
                onPress={() =>
                  Alert.alert(
                    'Lupa PIN',
                    'Silakan hubungi admin pesantren untuk mereset PIN Anda.',
                    [{ text: 'OK' }]
                  )
                }
                activeOpacity={interaction.activeOpacity}
              >
                <AppText variant="caption" color="brand" style={styles.forgotLink}>
                  Hubungi Admin
                </AppText>
              </TouchableOpacity>
            </View>

            <View style={styles.vendorFooter}>
              <AppText variant="caption" color="muted" style={styles.vendorText}>
                Powered by KlikPesantren
              </AppText>
              <AppText variant="caption" color="muted">
                Versi {APP_VERSION}
              </AppText>
            </View>
          </AppCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.surfaceSoft,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing['2xl'],
  },
  hero: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['2xl'],
    paddingHorizontal: spacing['2xl'],
    gap: spacing.sm,
  },
  heroTitle: {
    textAlign: 'center',
    letterSpacing: 0.3,
    marginTop: spacing.sm,
  },
  heroTagline: {
    textAlign: 'center',
    opacity: 0.9,
  },
  formCard: {
    marginHorizontal: spacing.lg,
    marginTop: -spacing.lg,
  },
  formTitle: {
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  errorText: {
    flex: 1,
    lineHeight: 18,
  },
  field: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  fieldError: {
    marginTop: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSoft,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  pinWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  pinInput: {
    paddingRight: spacing['3xl'],
    letterSpacing: 4,
  },
  eyeBtn: {
    position: 'absolute',
    right: spacing.md,
    padding: spacing.xs,
  },
  loginBtn: {
    marginTop: spacing.sm,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  forgotLink: {
    fontWeight: '700',
  },
  vendorFooter: {
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  vendorText: {
    fontSize: 11,
    opacity: 0.75,
  },
});
