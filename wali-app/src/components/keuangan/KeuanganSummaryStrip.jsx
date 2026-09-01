import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AppCard, AppText, StatusBadge } from '../ui';
import { formatCurrency } from '../../utils/formatCurrency';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/theme';

export function KeuanganSummaryStrip({ saldo = 0, tagihanAktif, tagihanStatus = 'Lunas', showSahriyah, showWallet, rfidEnabled }) {
  const amount = tagihanAktif?.sisa_tagihan ?? 0;
  const hasTagihan = tagihanAktif != null;

  return (
    <AppCard padding="md" style={styles.card}>
      <View style={styles.row}>
        {showSahriyah ? <View style={styles.col}>
          <AppText variant="caption" color="muted" numberOfLines={1}>
            Tagihan Aktif
          </AppText>
          <AppText variant="bodyMedium" numberOfLines={1}>
            {hasTagihan ? formatCurrency(amount) : '—'}
          </AppText>
          <StatusBadge status={tagihanStatus} size="sm">
            {tagihanStatus}
          </StatusBadge>
        </View> : null}

        {showSahriyah && showWallet ? <View style={styles.divider} /> : null}

        {showWallet ? <View style={styles.col}>
          <AppText variant="caption" color="muted" numberOfLines={1}>
            {rfidEnabled ? 'Saldo Dompet & RFID' : 'Saldo Dompet'}
          </AppText>
          <AppText variant="bodyMedium" numberOfLines={1}>
            {formatCurrency(saldo)}
          </AppText>
        </View> : null}
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    maxHeight: 80,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  col: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  divider: {
    width: 1,
    height: 48,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
});
