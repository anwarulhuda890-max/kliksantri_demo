import { BUILD_BRAND } from '../config/buildBrand';

function mix(hex, target, amount) {
  const source = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16));
  const destination = target.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16));
  return `#${source.map((value, index) => Math.round(value + (destination[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Wali App V2 — Brand Palette
 * Aligns with KlikPesantren Admin Design System V3
 */
export const colors = {
  // Brand core
  primary: BUILD_BRAND.primaryColor,
  primaryHover: mix(BUILD_BRAND.primaryColor, '#000000', 0.14),
  primaryDark: mix(BUILD_BRAND.primaryColor, '#000000', 0.2),
  primarySoft: mix(BUILD_BRAND.primaryColor, '#FFFFFF', 0.85),

  navy: '#0F172A',
  navySoft: '#1E293B',

  // Semantic
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  success: '#15803D',

  // Semantic subtle backgrounds
  dangerSoft: '#FEE2E2',
  warningSoft: '#FEF3C7',
  infoSoft: '#DBEAFE',
  successSoft: '#DCFCE7',
  neutralSoft: '#F1F5F9',

  // Surfaces
  surface: '#FFFFFF',
  surfaceSoft: '#F8FAFC',
  border: '#E2E8F0',

  // Text
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',

  // ── Legacy aliases (existing screens — migrate in later sprints) ──
  primaryLight: '#DCFCE7',
  secondary: '#F59E0B',
  secondaryLight: '#FEF3C7',
  dangerLight: '#FEE2E2',
  warningLight: '#FEF3C7',
  successLight: '#DCFCE7',
  infoLight: '#DBEAFE',
  white: '#FFFFFF',
  black: '#0F172A',
  background: '#F8FAFC',
  card: '#FFFFFF',
  text: '#0F172A',
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1E293B',
};
