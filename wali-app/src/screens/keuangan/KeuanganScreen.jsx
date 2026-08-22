import React, { useMemo } from 'react';

import {

  ScrollView,

  RefreshControl,

  TouchableOpacity,

  View,

  StyleSheet,

} from 'react-native';

import { useNavigation } from '@react-navigation/native';

import { useActiveChild } from '../../context/ActiveChildContext';
import { useWaliFeatures } from '../../hooks/useWaliFeatures';

import { useSahriyah } from '../../hooks/useSahriyah';

import { useRFID } from '../../hooks/useRFID';

import { TabPesantrenHeader } from '../../components/home/TabPesantrenHeader';

import { KeuanganSummaryStrip } from '../../components/keuangan/KeuanganSummaryStrip';

import {

  ScreenContainer,

  AppCard,

  AppText,

  SectionHeading,

  StatusBadge,

  EmptyState,

} from '../../components/ui';

import { LoadingSpinner } from '../../components/common/LoadingSpinner';

import { ErrorView } from '../../components/common/ErrorView';

import { formatCurrency } from '../../utils/formatCurrency';

import { formatDate, monthName } from '../../utils/formatDate';

import { colors } from '../../constants/colors';

import { interaction, spacing } from '../../constants/theme';



export function KeuanganScreen() {

  const navigation = useNavigation();

  const { activeSantriId, activeChild } = useActiveChild();
  const { features } = useWaliFeatures(activeChild);

  const sahriyah = useSahriyah(activeSantriId);

  const rfid = useRFID(activeSantriId, features.rfid);



  const tagihanAktif = useMemo(() => {

    return (sahriyah.data ?? []).find(

      (row) => row.status?.toLowerCase() !== 'lunas'

    );

  }, [sahriyah.data]);



  const tagihanStatus = tagihanAktif?.status ?? 'Lunas';



  const loading = (sahriyah.isLoading && !sahriyah.data.length) || rfid.isLoadingFirst;

  const refreshing = sahriyah.isRefreshing || rfid.isRefreshing;



  function refreshAll() {

    sahriyah.refresh();

    rfid.refresh();

  }



  if (!activeSantriId) {

    return (

      <ScreenContainer edges={false}>

        <TabPesantrenHeader />

        <EmptyState title="Pilih Anak" description="Tidak ada santri aktif." />

      </ScreenContainer>

    );

  }



  if (loading) {

    return (

      <ScreenContainer edges={false}>

        <TabPesantrenHeader />

        <LoadingSpinner message="Memuat keuangan..." />

      </ScreenContainer>

    );

  }



  if (sahriyah.error && rfid.error && !sahriyah.data.length) {

    return (

      <ScreenContainer edges={false}>

        <TabPesantrenHeader />

        <ErrorView message={sahriyah.error || rfid.error} onRetry={refreshAll} />

      </ScreenContainer>

    );

  }



  const saldo = rfid.saldo?.saldo ?? rfid.saldo?.saldo_akhir ?? 0;

  const sahriyahPreview = (sahriyah.data ?? []).slice(0, 3);

  const mutasiPreview = (rfid.mutasi ?? []).slice(0, 5);



  return (

    <ScreenContainer edges={false}>

      <TabPesantrenHeader />



      <ScrollView

        contentContainerStyle={styles.scroll}

        showsVerticalScrollIndicator={false}

        refreshControl={

          <RefreshControl

            refreshing={refreshing}

            onRefresh={refreshAll}

            colors={[colors.primary]}

            tintColor={colors.primary}

          />

        }

      >

        <SectionHeading title="Tagihan & Saldo" />

        <KeuanganSummaryStrip

          saldo={saldo}

          tagihanAktif={tagihanAktif}

          tagihanStatus={tagihanStatus}

        />



        <View style={styles.section}>

          <View style={styles.sectionHead}>

            <AppText variant="h3">Sahriyah</AppText>

            <TouchableOpacity

              onPress={() => navigation.navigate('Sahriyah')}

              activeOpacity={interaction.activeOpacity}

            >

              <AppText variant="caption" color="brand" style={styles.link}>

                Lihat semua

              </AppText>

            </TouchableOpacity>

          </View>

          <AppCard padding="md">

            {sahriyahPreview.length === 0 ? (

              <EmptyState title="Belum ada tagihan" icon="receipt-outline" />

            ) : (

              sahriyahPreview.map((row, i) => (

                <TouchableOpacity

                  key={row.id ?? i}

                  style={styles.rowItem}

                  onPress={() =>

                    navigation.navigate('DetailTagihan', {

                      tagihanId: row.id,

                      title: `${monthName(row.bulan)} ${row.tahun}`,

                      tagihan: row,

                    })

                  }

                  activeOpacity={interaction.activeOpacity}

                >

                  <View style={styles.rowLeft}>

                    <AppText variant="bodyMedium">

                      {monthName(row.bulan)} {row.tahun}

                    </AppText>

                    <AppText variant="caption" color="muted">

                      Sisa {formatCurrency(row.sisa_tagihan)}

                    </AppText>

                  </View>

                  <StatusBadge status={row.status} />

                </TouchableOpacity>

              ))

            )}

          </AppCard>

        </View>



        {features.rfid ? (
        <View style={styles.section}>

          <View style={styles.sectionHead}>

            <AppText variant="h3">RFID</AppText>

            <TouchableOpacity

              onPress={() => navigation.navigate('RFID')}

              activeOpacity={interaction.activeOpacity}

            >

              <AppText variant="caption" color="brand" style={styles.link}>

                Lihat semua

              </AppText>

            </TouchableOpacity>

          </View>

          <AppCard padding="md">

            {mutasiPreview.length === 0 ? (

              <EmptyState title="Belum ada mutasi" icon="swap-horizontal-outline" />

            ) : (

              mutasiPreview.map((row, i) => (

                <View key={row.id ?? i} style={styles.rowItem}>

                  <View style={styles.rowLeft}>

                    <AppText variant="bodyMedium" numberOfLines={1}>

                      {row.keterangan ?? row.tipe ?? 'Transaksi'}

                    </AppText>

                    <AppText variant="caption" color="muted">

                      {formatDate(row.tanggal ?? row.created_at)}

                    </AppText>

                  </View>

                  <AppText variant="bodyMedium">{formatCurrency(row.nominal)}</AppText>

                </View>

              ))

            )}

          </AppCard>

        </View>
        ) : null}

      </ScrollView>

    </ScreenContainer>

  );

}



const styles = StyleSheet.create({

  scroll: { paddingTop: spacing.md, paddingBottom: spacing['3xl'] },

  section: {

    paddingHorizontal: spacing.lg,

    marginBottom: spacing.lg,

  },

  sectionHead: {

    flexDirection: 'row',

    justifyContent: 'space-between',

    alignItems: 'center',

    marginBottom: spacing.sm,

  },

  link: { fontWeight: '700' },

  rowItem: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    paddingVertical: spacing.sm,

    borderBottomWidth: 1,

    borderBottomColor: colors.border,

    gap: spacing.sm,

  },

  rowLeft: { flex: 1, minWidth: 0 },

});


