// Fleet — "Drivers and vehicles. One permanent ID each." Vehicles and Drivers under one tab (client reference vVehicles).
// The two lists keep every earlier feature: add / link by registration or mobile, pairing, documents, status, invitations.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../context/VendorData';
import { PButton, UTabs } from '../components/partner';
import { VehiclesScreen } from './VehiclesScreen';
import { DriversScreen } from './DriversScreen';
import type { TabParamList } from '../navigation/types';
import { colors, space } from '../theme';

export function FleetScreen() {
  const route = useRoute<RouteProp<TabParamList, 'Fleet'>>();
  const navigation = useNavigation();
  const { vehicles, drivers, openLinks } = useVendorData();
  const param = route.params?.tab;
  const [tab, setTab] = useState<'Vehicles' | 'Drivers'>(param === 'Drivers' ? 'Drivers' : 'Vehicles');
  // A deep link to Vehicles / Drivers (notification, "Add driver") switches the list once per request.
  const [seen, setSeen] = useState(param);
  if (param !== seen) {
    setSeen(param);
    if (param) setTab(param);
  }
  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <UTabs value={tab} onChange={setTab} items={[{ id: 'Vehicles', label: 'Vehicles', count: vehicles.length }, { id: 'Drivers', label: 'Drivers', count: drivers.length }]} />
        <View style={styles.links}>
          <PButton style="text" icon="swap-horizontal-outline" title={openLinks.length ? `Linking requests (${openLinks.length})` : 'Linking requests'} onPress={() => navigation.navigate('Requests')} />
          <PButton style="text" icon="document-text-outline" title="Documents & verification" onPress={() => navigation.navigate('Documents')} />
        </View>
      </View>
      <View style={{ flex: 1 }}>{tab === 'Vehicles' ? <VehiclesScreen /> : <DriversScreen />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.bg },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: -4 },
});
