import React from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useActiveChild } from '../../context/ActiveChildContext';
import {
  ScreenContainer,
  AppText,
  StatusBadge,
  EmptyState,
} from '../../components/ui';
import { colors } from '../../constants/colors';
import { interaction, radius, spacing } from '../../constants/theme';

function MetaItem({ label, value }) {
  return (
    <View style={styles.metaItem}>
      <AppText variant="caption" color="muted">
        {label}
      </AppText>
      <AppText variant="bodyMedium" numberOfLines={1}>
        {value ?? '—'}
      </AppText>
    </View>
  );
}

function AnakCard({ anak, isActive, onPress }) {
  const statusLabel = isActive ? 'Dipilih' : (anak.status ?? 'Aktif');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={interaction.cardActiveOpacity}
      style={[styles.card, isActive ? styles.cardActive : styles.cardInactive]}
    >
      <View style={styles.cardHeader}>
        <AppText variant="h3" numberOfLines={1} style={styles.nama}>
          {anak.nama}
        </AppText>
        {isActive ? (
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={14} color={colors.surface} />
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <MetaItem label="Kelas" value={anak.nama_kelas} />
        <View style={styles.metaDivider} />
        <MetaItem label="Unit" value={anak.unit_nama || anak.unit_kode} />
        <View style={styles.metaDivider} />
        <MetaItem label="Kamar" value={anak.kamar ? `Kamar ${anak.kamar}` : null} />
        <View style={styles.metaDivider} />
        <View style={styles.metaItem}>
          <AppText variant="caption" color="muted">
            Status
          </AppText>
          <StatusBadge status={statusLabel} size="sm">
            {statusLabel}
          </StatusBadge>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function AnakPilihScreen() {
  const navigation = useNavigation();
  const { anak } = useAuth();
  const { activeSantriId, activeUnitId, setActiveSantri } = useActiveChild();

  async function handlePilih(child) {
    await setActiveSantri(child);
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <AppText variant="h2">Pilih Anak</AppText>
        <AppText variant="caption" color="secondary">
          Data ditampilkan sesuai anak yang dipilih
        </AppText>
      </View>

      <FlatList
        data={anak}
        keyExtractor={(item) => `${item.santri_id ?? item.id}:${item.unit_id}`}
        renderItem={({ item }) => (
          <AnakCard
            anak={item}
            isActive={Number(item.santri_id ?? item.id) === Number(activeSantriId)
              && Number(item.unit_id) === Number(activeUnitId)}
            onPress={() => handlePilih(item)}
          />
        )}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="Tidak Ada Santri"
            description="Tidak ada santri yang terdaftar pada akun ini."
          />
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  list: {
    padding: spacing.lg,
    flexGrow: 1,
  },
  separator: {
    height: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 2,
  },
  cardActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  cardInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  nama: {
    flex: 1,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  metaItem: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  metaDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
    alignSelf: 'stretch',
  },
});
