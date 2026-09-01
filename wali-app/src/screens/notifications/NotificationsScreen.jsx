import React, { useCallback, useEffect } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenContainer, AppText, AppCard, AppButton, EmptyState } from '../../components/ui';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorView } from '../../components/common/ErrorView';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../context/AuthContext';
import { useActiveChild } from '../../context/ActiveChildContext';
import { colors } from '../../constants/colors';
import { interaction, radius, spacing } from '../../constants/theme';
import { registerPushTokenBackground } from '../../services/pushNotificationService';
import { featuresApi } from '../../api/features.api';

const TYPE_META = {
  pelanggaran: {
    featureKey: 'pelanggaran',
    icon: 'alert-circle-outline',
    color: colors.danger,
    route: { tab: 'Monitoring', screen: 'Pelanggaran' },
  },
  perizinan: {
    featureKey: 'perizinan',
    icon: 'document-text-outline',
    color: colors.warning,
    route: { tab: 'Monitoring', screen: 'Perizinan' },
  },
  kesehatan: {
    featureKey: 'kesehatan',
    icon: 'heart-outline',
    color: colors.danger,
    route: { tab: 'Monitoring', screen: 'Kesehatan' },
  },
  pengumuman: {
    featureKey: 'pengumuman',
    icon: 'megaphone-outline',
    color: colors.info,
    route: { tab: 'Pengumuman', screen: 'PengumumanHome' },
  },
  sahriyah: {
    featureKey: 'sahriyah',
    icon: 'receipt-outline',
    color: colors.success,
    route: { tab: 'Keuangan', screen: 'Sahriyah' },
  },
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function NotificationItem({ item, onPress }) {
  const meta = TYPE_META[item.type] ?? {
    icon: 'notifications-outline',
    color: colors.primary,
    route: null,
  };
  const unread = !item.read_at;

  return (
    <TouchableOpacity
      activeOpacity={interaction.activeOpacity}
      onPress={() => onPress(item)}
      style={styles.itemPress}
    >
      <AppCard padding="sm" shadow="sm" style={[styles.item, unread && styles.itemUnread]}>
        <View style={[styles.iconWrap, { backgroundColor: `${meta.color}14` }]}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>
        <View style={styles.itemBody}>
          <View style={styles.itemHeader}>
            <AppText variant="bodyMedium" numberOfLines={1} style={styles.itemTitle}>
              {item.title}
            </AppText>
            {unread ? <View style={styles.unreadDot} /> : null}
          </View>
          <AppText variant="body" color="secondary" numberOfLines={2} style={styles.itemText}>
            {item.body}
          </AppText>
          <AppText variant="caption" color="muted" style={styles.itemTime}>
            {formatDate(item.created_at)}
          </AppText>
        </View>
      </AppCard>
    </TouchableOpacity>
  );
}

export function NotificationsScreen({ navigation }) {
  const {
    items,
    unreadCount,
    isLoading,
    error,
    refresh,
    markRead,
    markAllRead,
  } = useNotifications();
  const { anak } = useAuth();
  const { setActiveSantri } = useActiveChild();

  useEffect(() => {
    registerPushTokenBackground({
      source: 'notificationsScreen',
      requestPermission: true,
    });
  }, []);

  const navigateFromItem = useCallback(async (item) => {
    if (!item.read_at) {
      await markRead(item.id);
    }

    const meta = TYPE_META[item.type];
    const santriId = item.santri_id ?? item.data?.santri_id;
    const unitId = item.unit_id ?? item.data?.unit_id;
    const matches = anak.filter((row) => String(row.santri_id ?? row.id) === String(santriId));
    const child = unitId != null
      ? matches.find((row) => Number(row.unit_id) === Number(unitId))
      : matches.length === 1 ? matches[0] : null;

    const fallback = () => navigation.navigate('MainTabs', { screen: 'Beranda' });
    if (!child || !meta?.route) {
      fallback();
      return;
    }

    await setActiveSantri(child);

    try {
      const capabilityResponse = await featuresApi.getFeatures();
      const capabilities = capabilityResponse.data ?? {};
      if (
        Number(capabilities.unit_id) !== Number(child.unit_id)
        || capabilities[meta.featureKey] !== true
      ) {
        fallback();
        return;
      }
    } catch {
      fallback();
      return;
    }

    navigation.navigate('MainTabs', {
      screen: meta.route.tab,
      params: meta.route.screen ? { screen: meta.route.screen } : undefined,
    });
  }, [anak, markRead, navigation, setActiveSantri]);

  const handleReadAll = async () => {
    if (unreadCount <= 0) return;
    await markAllRead();
  };

  if (isLoading && items.length === 0) {
    return (
      <ScreenContainer style={styles.screen}>
        <LoadingSpinner message="Memuat notifikasi..." />
      </ScreenContainer>
    );
  }

  if (error && items.length === 0) {
    return (
      <ScreenContainer style={styles.screen}>
        <ErrorView message={error} onRetry={refresh} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => refresh({ silent: true })}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View>
              <AppText variant="h2" style={styles.headerTitle}>Notifikasi</AppText>
              <AppText variant="body" color="secondary">
                {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
              </AppText>
            </View>
            <AppButton variant="ghost" size="sm" onPress={handleReadAll} disabled={unreadCount <= 0}>
              Tandai dibaca
            </AppButton>
          </View>
        }
        renderItem={({ item }) => (
          <NotificationItem item={item} onPress={navigateFromItem} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <EmptyState
              title="Belum ada notifikasi"
              description="Pembaruan penting dari pesantren akan tampil di sini."
              icon="notifications-outline"
            />
          </View>
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.surfaceSoft,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontWeight: '800',
  },
  itemPress: {
    borderRadius: radius.lg,
  },
  item: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  itemUnread: {
    borderColor: colors.primary,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemTitle: {
    flex: 1,
    fontWeight: '800',
  },
  itemText: {
    marginTop: 3,
    lineHeight: 20,
  },
  itemTime: {
    marginTop: spacing.sm,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  emptyWrap: {
    marginTop: spacing['3xl'],
  },
});
