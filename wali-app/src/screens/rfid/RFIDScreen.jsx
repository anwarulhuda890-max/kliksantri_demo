import React, { useCallback } from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useActiveChild } from '../../context/ActiveChildContext';
import { useRFID } from '../../hooks/useRFID';
import { useWaliFeatures } from '../../hooks/useWaliFeatures';
import { ChildSwitcherBar } from '../../components/dashboard/ChildSwitcherBar';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorView } from '../../components/common/ErrorView';
import {
  ScreenContainer,
  AppCard,
  AppText,
  StatusBadge,
  EmptyState,
  ListSectionHeader,
  StaleDataBanner,
} from '../../components/ui';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/theme';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';

function getTrxMeta(trxType) {
  const t = (trxType ?? '').toLowerCase();
  if (t.includes('topup') || t.includes('top_up')) {
    return { label: 'Top Up', variant: 'success', sign: '+', icon: 'arrow-down-circle' };
  }
  if (t.includes('payment') || t.includes('belanja') || t.includes('bayar')) {
    return { label: 'Belanja', variant: 'danger', sign: '-', icon: 'arrow-up-circle' };
  }
  return { label: trxType ?? 'Transaksi', variant: 'neutral', sign: '', icon: 'swap-horizontal' };
}

function SaldoHeader({ saldo, activeChild, rfidEnabled }) {
  const kartuAktif = saldo?.kartu_aktif ?? false;
  const nominal = saldo?.saldo ?? 0;
  const limitHarian = saldo?.limit_harian ?? 0;

  return (
    <AppCard padding="lg" style={styles.saldoCard} accent="primary">
      <View style={styles.saldoTop}>
        <AppText variant="bodyMedium" color="inverse">{rfidEnabled ? 'Saldo Dompet & RFID' : 'Saldo Dompet'}</AppText>
        {rfidEnabled ? <StatusBadge variant={kartuAktif ? 'success' : 'neutral'} size="sm">
          {kartuAktif ? 'Kartu Aktif' : 'Tidak Ada Kartu'}
        </StatusBadge> : null}
      </View>
      <AppText variant="display" color="inverse">{formatCurrency(nominal)}</AppText>
      {limitHarian > 0 ? (
        <AppText variant="caption" style={styles.saldoSub}>
          Limit harian {formatCurrency(limitHarian)}
        </AppText>
      ) : null}
      {activeChild?.nama ? (
        <AppText variant="caption" style={styles.saldoSub}>a/n {activeChild.nama}</AppText>
      ) : null}
    </AppCard>
  );
}

function MutasiItem({ item }) {
  const meta = getTrxMeta(item.trx_type);
  const isPositive = meta.sign === '+';

  return (
    <AppCard padding="sm" style={styles.mutasiRow}>
      <View style={[styles.mutasiIcon, { backgroundColor: isPositive ? colors.successSoft : colors.dangerSoft }]}>
        <Ionicons name={meta.icon} size={20} color={colors[meta.variant] ?? colors.textSecondary} />
      </View>
      <View style={styles.mutasiBody}>
        <AppText variant="bodyMedium" numberOfLines={1}>
          {item.nama_merchant ?? item.keterangan ?? 'Transaksi'}
        </AppText>
        <AppText variant="caption" color="muted">
          {formatDate(item.created_at ?? item.tanggal)}
        </AppText>
        <StatusBadge variant={meta.variant} size="sm">{meta.label}</StatusBadge>
      </View>
      <View style={styles.mutasiAmounts}>
        <AppText variant="bodyMedium" color={meta.variant}>
          {meta.sign}{formatCurrency(item.nominal)}
        </AppText>
        <AppText variant="caption" color="muted">{formatCurrency(item.saldo_akhir)}</AppText>
      </View>
    </AppCard>
  );
}

export function RFIDScreen() {
  const { activeSantriId, activeChild } = useActiveChild();
  const { features } = useWaliFeatures(activeChild);
  const {
    saldo,
    mutasi,
    total,
    hasMore,
    isLoadingFirst,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
  } = useRFID(activeSantriId, features.wallet === true);

  const handleEndReached = useCallback(() => {
    if (!isLoadingMore && hasMore) loadMore();
  }, [isLoadingMore, hasMore, loadMore]);

  if (isLoadingFirst && !saldo) {
    return (
      <ScreenContainer>
        <ChildSwitcherBar />
        <LoadingSpinner message="Memuat data dompet..." />
      </ScreenContainer>
    );
  }

  if (error && !saldo) {
    return (
      <ScreenContainer>
        <ChildSwitcherBar />
        <ErrorView message={error} onRetry={refresh} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <FlatList
        data={mutasi}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <MutasiItem item={item} />}
        ListHeaderComponent={
          <>
            <ChildSwitcherBar />
            <SaldoHeader saldo={saldo} activeChild={activeChild} rfidEnabled={features.rfid === true} />
            <ListSectionHeader title="Riwayat Mutasi" count={total > 0 ? `${total} transaksi` : null} />
            {error && saldo ? <StaleDataBanner /> : null}
          </>
        }
        ListEmptyComponent={
          !isLoadingFirst ? (
            <EmptyState title="Belum Ada Transaksi" description="Riwayat mutasi dompet akan muncul di sini." icon="wallet-outline" />
          ) : null
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="caption" color="muted">Memuat lebih banyak...</AppText>
            </View>
          ) : !hasMore && total > 0 ? (
            <View style={styles.footer}>
              <AppText variant="caption" color="muted">
                Menampilkan {mutasi.length} dari {total} transaksi
              </AppText>
            </View>
          ) : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing['3xl'] },
  sep: { height: spacing.sm },
  saldoCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.primary,
    gap: spacing.sm,
  },
  saldoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saldoSub: { color: 'rgba(255,255,255,0.75)' },
  mutasiRow: { flexDirection: 'row', marginHorizontal: spacing.lg, gap: spacing.md, alignItems: 'center' },
  mutasiIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mutasiBody: { flex: 1, minWidth: 0, gap: spacing.xs },
  mutasiAmounts: { alignItems: 'flex-end' },
  footer: { alignItems: 'center', padding: spacing.lg, gap: spacing.sm },
});
