import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useActiveChild } from '../../context/ActiveChildContext';
import { useWaliFeatures } from '../../hooks/useWaliFeatures';
import { ChildSwitcherBar } from '../../components/dashboard/ChildSwitcherBar';
import { colors } from '../../constants/colors';

function MenuCard({ icon, title, subtitle, onPress, accentColor }) {
  return (
    <TouchableOpacity
      style={[styles.menuCard, { borderLeftColor: accentColor }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.menuIconWrap, { backgroundColor: accentColor + '18' }]}>
        <Text style={styles.menuIcon}>{icon}</Text>
      </View>
      <View style={styles.menuBody}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.menuArrow}>›</Text>
    </TouchableOpacity>
  );
}

export function KeuanganHubScreen() {
  const navigation = useNavigation();
  const { activeChild } = useActiveChild();
  const { features } = useWaliFeatures(activeChild);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <ChildSwitcherBar />
        {activeChild ? (
          <View style={styles.childBanner}>
            <Text style={styles.childBannerText}>
              Data untuk: <Text style={styles.childBannerName}>{activeChild.nama}</Text>
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Pilih Modul Keuangan</Text>

        {features.wallet === true ? <MenuCard
          icon="💳"
          title={features.rfid === true ? 'Dompet & RFID' : 'Dompet Santri'}
          subtitle={features.rfid === true ? 'Lihat saldo, kartu, dan riwayat transaksi' : 'Lihat saldo dan riwayat transaksi'}
          accentColor={colors.primary}
          onPress={() => navigation.navigate('RFID')}
        /> : null}

        {features.sahriyah === true ? <MenuCard
          icon="📋"
          title="Sahriyah"
          subtitle="Status tagihan bulanan dan riwayat pembayaran"
          accentColor={colors.secondary}
          onPress={() => navigation.navigate('Sahriyah')}
        /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, gap: 12 },

  childBanner: {
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 4,
  },
  childBannerText: {
    fontSize: 13,
    color: colors.primaryDark,
  },
  childBannerName: {
    fontWeight: '700',
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
  },

  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    gap: 14,
  },
  menuIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIcon: { fontSize: 24 },
  menuBody: { flex: 1 },
  menuTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  menuArrow: {
    fontSize: 22,
    color: colors.gray300,
    fontWeight: '300',
  },
});
