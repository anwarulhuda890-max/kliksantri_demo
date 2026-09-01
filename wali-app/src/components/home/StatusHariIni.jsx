import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../ui';
import { formatCurrency } from '../../utils/formatCurrency';
import { colors } from '../../constants/colors';
import { interaction, radius, shadows, spacing } from '../../constants/theme';

const TONES = {
  attendance: { iconBg: 'rgba(21, 128, 61, 0.10)', icon: colors.primary },
  health: { iconBg: 'rgba(239, 68, 68, 0.10)', icon: colors.danger },
  memorization: { iconBg: 'rgba(245, 158, 11, 0.10)', icon: colors.warning },
  finance: { iconBg: 'rgba(124, 58, 237, 0.10)', icon: '#7C3AED' },
  danger: { iconBg: 'rgba(239, 68, 68, 0.10)', icon: colors.danger },
};

function dash(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

function buildItems(d, features = {}) {
  if (!d) return [];

  const isSakit = d.kesehatan_aktif?.status_kesehatan === 'sakit';
  const hafalan = d.hafalan_bulan_ini;
  const sahStatus = d.sahriyah_aktif?.status?.toLowerCase();
  const sahriyahLunas = !d.sahriyah_aktif || sahStatus === 'lunas';
  const hadir = d.kehadiran?.hadir;
  const total = d.kehadiran?.total;

  const items = [
    features.absensi === true ? {
      key: 'kehadiran',
      icon: 'checkmark-circle-outline',
      label: 'Kehadiran',
      value: (d.izin_aktif ?? 0) > 0 ? 'Izin' : 'Aktif',
      desc:
        hadir != null && total != null
          ? `${hadir}/${total} hadir`
          : '—',
      tone: (d.izin_aktif ?? 0) > 0 ? 'memorization' : 'attendance',
    } : null,
    features.kesehatan === true ? {
      key: 'kesehatan',
      icon: 'heart-outline',
      label: 'Kesehatan',
      value: isSakit ? 'Sakit' : 'Sehat',
      desc: isSakit ? 'Perlu perhatian' : 'Kondisi baik',
      tone: 'health',
    } : null,
    features.hafalan === true ? {
      key: 'hafalan',
      icon: 'star-outline',
      label: 'Hafalan',
      value: dash(hafalan ?? 0),
      desc: 'Setoran',
      tone: 'memorization',
    } : null,
    (features.wallet === true || features.sahriyah === true) ? {
      key: 'keuangan',
      icon: 'wallet-outline',
      label: 'Keuangan',
      value: sahriyahLunas ? 'Aman' : 'Belum',
      desc: features.sahriyah === true && !sahriyahLunas
        ? formatCurrency(d.sahriyah_aktif?.sisa_tagihan ?? 0)
        : features.wallet === true
          ? formatCurrency(d.saldo_dompet ?? 0)
          : 'Sahriyah lunas',
      tone: sahriyahLunas ? 'finance' : 'memorization',
    } : null,
  ];
  return items.filter(Boolean);
}

function StatusTile({ item }) {
  const tone = TONES[item.tone] ?? TONES.health;

  return (
    <View style={styles.tile}>
      <View style={[styles.tileIcon, { backgroundColor: tone.iconBg }]}>
        <Ionicons name={item.icon} size={14} color={tone.icon} />
      </View>
      <View style={styles.tileText}>
        <AppText variant="caption" color="secondary" numberOfLines={1} style={styles.tileLabel}>
          {item.label}
        </AppText>
        <AppText variant="h2" numberOfLines={1} style={styles.tileValue}>
          {item.value}
        </AppText>
        <AppText variant="caption" color="muted" numberOfLines={1} style={styles.tileDesc}>
          {item.desc}
        </AppText>
      </View>
    </View>
  );
}

export function StatusHariIni({ data, onLihatSemua, features }) {
  const items = buildItems(data, features);
  if (!items.length) return null;

  return (
    <View style={[styles.wrap, shadows.sm]}>
      <View style={styles.head}>
        <AppText variant="h3" style={styles.title}>
          Status Anak Hari Ini
        </AppText>
        {onLihatSemua ? (
          <TouchableOpacity style={styles.detailBtn} onPress={onLihatSemua} activeOpacity={interaction.activeOpacity}>
            <AppText variant="caption" color="brand" style={styles.link}>
              Lihat Detail
            </AppText>
            <Ionicons name="chevron-forward" size={15} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.grid}>
        {items.map((item) => (
          <StatusTile key={item.key} item={item} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius['2xl'],
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontWeight: '800',
    fontSize: 15,
    lineHeight: 19,
  },
  detailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  link: {
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 84,
    paddingVertical: spacing.sm,
    paddingHorizontal: 3,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  tileIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: {
    minWidth: 0,
    alignItems: 'center',
  },
  tileLabel: {
    fontWeight: '600',
    fontSize: 9,
    lineHeight: 11,
    textAlign: 'center',
  },
  tileValue: {
    fontWeight: '800',
    fontSize: 14,
    lineHeight: 17,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  tileDesc: {
    fontWeight: '500',
    fontSize: 8,
    lineHeight: 10,
    textAlign: 'center',
  },
});
