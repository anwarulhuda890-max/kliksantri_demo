import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { stackHeaderOptions } from '../constants/theme';
import { KeuanganScreen } from '../screens/keuangan/KeuanganScreen';
import { RFIDScreen } from '../screens/rfid/RFIDScreen';
import { SahriyahScreen } from '../screens/sahriyah/SahriyahScreen';
import { DetailTagihanScreen } from '../screens/sahriyah/DetailTagihanScreen';
import { useActiveChild } from '../context/ActiveChildContext';
import { useWaliFeatures } from '../hooks/useWaliFeatures';

const Stack = createNativeStackNavigator();

export function KeuanganStack() {
  const { activeChild } = useActiveChild();
  const { features } = useWaliFeatures(activeChild);
  return (
    <Stack.Navigator screenOptions={stackHeaderOptions}>
      <Stack.Screen
        name="KeuanganHome"
        component={KeuanganScreen}
        options={{ headerShown: false }}
      />
      {features.rfid ? <Stack.Screen name="RFID" component={RFIDScreen} options={{ title: 'Saldo & Mutasi RFID' }} /> : null}
      <Stack.Screen name="Sahriyah" component={SahriyahScreen} options={{ title: 'Sahriyah' }} />
      <Stack.Screen
        name="DetailTagihan"
        component={DetailTagihanScreen}
        options={({ route }) => ({
          title: route.params?.title ? `Sahriyah ${route.params.title}` : 'Detail Tagihan',
        })}
      />
    </Stack.Navigator>
  );
}
