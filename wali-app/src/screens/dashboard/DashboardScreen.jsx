import React from 'react';
import {
  ScrollView,
  RefreshControl,
  View,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useActiveChild } from '../../context/ActiveChildContext';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../hooks/useDashboard';
import { usePengumuman } from '../../hooks/usePengumuman';
import { useProfilPesantren } from '../../hooks/useProfilPesantren';
import { useNotifications } from '../../hooks/useNotifications';
import { useWaliFeatures } from '../../hooks/useWaliFeatures';
import { useHomeLinks } from '../../hooks/useHomeLinks';
import { SantriHeroCard } from '../../components/home/SantriHeroCard';
import { PesantrenImageCard } from '../../components/home/PesantrenImageCard';
import { QuickAccessGrid } from '../../components/home/QuickAccessGrid';
import { StatusHariIni } from '../../components/home/StatusHariIni';
import { PengumumanTerbaruList } from '../../components/home/PengumumanTerbaruList';
import { HomeLinksFeed } from '../../components/home/HomeLinksFeed';
import {
  ScreenContainer,
  SectionHeading,
  EmptyState,
} from '../../components/ui';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorView } from '../../components/common/ErrorView';
import { colors } from '../../constants/colors';
import { getTabBarScrollInset, spacing } from '../../constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MONITORING_FEATURE_KEYS, hasAnyFeature } from '../../utils/unitFeatures';

export function DashboardScreen({ navigation: tabNavigation }) {
  const insets = useSafeAreaInsets();
  const { activeSantriId, activeChild } = useActiveChild();
  const { wali, anak } = useAuth();
  const { data, isLoading, error, refresh } = useDashboard(activeSantriId);
  const { features, refresh: refreshFeatures } = useWaliFeatures(activeChild);
  const { data: pengumuman, refresh: refreshPengumuman } = usePengumuman(features.pengumuman === true);
  const { data: pesantren, refresh: refreshPesantren } = useProfilPesantren();
  const { unreadCount, refreshUnreadCount } = useNotifications({ limit: 1 });
  const { data: homeLinks, refresh: refreshHomeLinks } = useHomeLinks();

  const hasPengumuman = features.pengumuman === true && (pengumuman?.length ?? 0) > 0;
  const hasMonitoring = hasAnyFeature(features, MONITORING_FEATURE_KEYS);
  const showGanti = anak.length > 1;
  const handleGantiAnak = () => {
    const parent = tabNavigation.getParent?.();
    if (parent) {
      parent.navigate('AnakPilih');
      return;
    }
    tabNavigation.navigate('AnakPilih');
  };
  const handleNotificationPress = () => {
    const parent = tabNavigation.getParent?.();
    if (parent) {
      parent.navigate('Notifications');
      return;
    }
    tabNavigation.navigate('Notifications');
  };

  const statistikPesantren = data?.statistik_pesantren;

  useFocusEffect(
    React.useCallback(() => {
      refreshUnreadCount();
    }, [refreshUnreadCount]),
  );

  const heroHeader = (
    <SantriHeroCard
      activeChild={activeChild}
      dashboardProfil={data?.profil}
      wali={wali}
      onGantiPress={showGanti ? handleGantiAnak : undefined}
      onNotificationPress={handleNotificationPress}
      unreadNotificationCount={unreadCount}
    />
  );

  if (!activeSantriId) {
    return (
      <ScreenContainer style={styles.screen} edges={false}>
        {heroHeader}
        <EmptyState title="Pilih Anak" description="Tidak ada santri yang dipilih." />
      </ScreenContainer>
    );
  }

  if (isLoading && !data) {
    return (
      <ScreenContainer style={styles.screen} edges={false}>
        {heroHeader}
        <LoadingSpinner message="Memuat beranda..." />
      </ScreenContainer>
    );
  }

  if (error && !data) {
    return (
      <ScreenContainer style={styles.screen} edges={false}>
        {heroHeader}
        <ErrorView message={error} onRetry={refresh} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.screen} edges={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: getTabBarScrollInset(insets) }]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => {
              refresh();
              refreshPengumuman();
              refreshPesantren();
              refreshUnreadCount();
              refreshFeatures();
              refreshHomeLinks();
            }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <SantriHeroCard
          activeChild={activeChild}
          dashboardProfil={data?.profil}
          wali={wali}
          onGantiPress={showGanti ? handleGantiAnak : undefined}
          onNotificationPress={handleNotificationPress}
          unreadNotificationCount={unreadCount}
        />

        <PesantrenImageCard
          pesantren={pesantren}
          statistik={statistikPesantren}
        />

        <StatusHariIni
          data={data}
          features={features}
          onLihatSemua={hasMonitoring ? () => tabNavigation.navigate('Monitoring') : undefined}
        />

        <SectionHeading
          title="Menu Utama"
          actionLabel={hasMonitoring ? 'Lihat Semua Menu' : undefined}
          onAction={hasMonitoring ? () => tabNavigation.navigate('Monitoring') : undefined}
        />
        <QuickAccessGrid navigation={tabNavigation} features={features} />

        {hasPengumuman ? (
          <PengumumanTerbaruList
            items={pengumuman}
            onItemPress={() => tabNavigation.navigate('Pengumuman')}
            onLihatSemua={() => tabNavigation.navigate('Pengumuman')}
          />
        ) : null}

        <HomeLinksFeed items={homeLinks} />

        <View style={styles.bottomPad} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F3F4F6',
  },
  scroll: {
    overflow: 'visible',
  },
  bottomPad: {
    height: spacing.lg,
  },
});
