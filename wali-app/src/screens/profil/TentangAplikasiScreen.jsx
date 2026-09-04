import React from 'react';
import Constants from 'expo-constants';
import { ScrollView, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useProfilPesantren } from '../../hooks/useProfilPesantren';
import {
  ScreenContainer,
  AppCard,
  AppText,
  AppButton,
} from '../../components/ui';
import { spacing } from '../../constants/theme';
import { colors } from '../../constants/colors';
import { BUILD_BRAND } from '../../config/buildBrand';

export function TentangAplikasiScreen() {
  const navigation = useNavigation();
  const { data: pesantren } = useProfilPesantren();

  const namaPesantren = pesantren?.nama_pesantren ?? 'Pesantren';
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scroll}>
        <AppCard padding="lg" style={styles.card}>
          <AppText variant="h2">{namaPesantren}</AppText>
          <AppText variant="caption" color="muted">
            {BUILD_BRAND.appName} · Versi {appVersion}
          </AppText>
          <View style={styles.divider} />
          <AppText variant="body" color="secondary">
            Aplikasi resmi untuk wali santri. Pantau kehadiran, akademik, keuangan,
            dan pengumuman pesantren dalam satu tempat.
          </AppText>
          <View style={styles.attribution}>
            <AppText variant="label">Powered by KlikPesantren</AppText>
            <AppText variant="caption" color="muted">
              Teknologi administrasi pesantren oleh KlikPesantren.
            </AppText>
          </View>
          <AppButton
            variant="outline"
            fullWidth
            onPress={() => navigation.navigate('ProfilPesantren')}
            style={styles.btn}
          >
            Tentang Pesantren
          </AppButton>
        </AppCard>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
  },
  card: {
    gap: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  btn: {
    marginTop: spacing.lg,
  },
  attribution: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
  },
});
