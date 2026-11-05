// Saved addresses (Home / Work / favourites): add, edit label, use as pickup, delete.
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { useCustomerData } from '../context/CustomerData';
import { useBookingDraft } from '../context/BookingDraft';
import { Button, EmptyState, Notice, Segmented, TextButton, TextField } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { Icon, type IconName } from '../components/Icon';
import { PlaceSearchModal } from '../components/PlaceSearchModal';
import { deleteSavedPlace, savePlace } from '../services/userService';
import { useDeviceLocation } from '../hooks/useDeviceLocation';
import type { GeoPlace, LocationItem } from '../types';
import { isValidLatLng } from '../utils/geo';
import { describeError } from '../utils/retry';
import { colors, fonts, space } from '../theme';

type SaveType = 'home' | 'work' | 'favorite';
const ICON: Record<string, IconName> = { home: 'house', work: 'briefcase', favorite: 'star' };

export function SavedPlacesScreen() {
  const navigation = useNavigation();
  const { profile, savedPlaces } = useCustomerData();
  const { update, setService } = useBookingDraft();
  const { position } = useDeviceLocation(false);
  const [adding, setAdding] = useState<LocationItem | 'new' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [picked, setPicked] = useState<GeoPlace | null>(null);
  const [kind, setKind] = useState<SaveType>('home');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const startEdit = (p: LocationItem) => {
    setAdding(p);
    setKind(p.type as SaveType);
    setLabel(p.type === 'favorite' ? p.name : '');
    setPicked(p as GeoPlace);
  };

  const reset = () => {
    setAdding(null);
    setPicked(null);
    setLabel('');
    setKind('home');
    setError('');
  };

  const save = async () => {
    if (!picked) return setError('Choose an address first.');
    const name = kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : label.trim() || 'Saved place';
    setBusy(true);
    setError('');
    try {
      await savePlace(
        {
          id: (typeof adding === 'object' && adding ? adding.id : '') || '',
          name,
          address: picked.address || picked.name,
          lat: picked.lat,
          lng: picked.lng,
          type: kind,
        },
        profile.uid,
      );
      reset();
    } catch (e) {
      setError(describeError(e, 'Couldn’t save this address.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = (p: LocationItem) =>
    Alert.alert(`Remove ${p.name}?`, 'You can add it again anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setDeleting(p.id);
          deleteSavedPlace(p.id)
            .catch((e: unknown) => setError(describeError(e, 'Couldn’t remove this address.')))
            .finally(() => setDeleting(null));
        },
      },
    ]);

  const pickupFrom = (p: LocationItem) => {
    if (!isValidLatLng(p as { lat?: number; lng?: number })) return;
    setService('outstation');
    update({ pickup: p as GeoPlace });
    navigation.navigate('Tabs', { screen: 'Book' });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Saved Addresses" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <PlaceSearchModal visible={searchOpen} title="Find an address" onClose={() => setSearchOpen(false)} onSelect={setPicked} near={position} />
        <Notice message={error} />

        {adding ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{adding === 'new' ? 'Add address' : 'Edit address'}</Text>
            <Segmented
              options={[
                { value: 'home', label: 'Home' },
                { value: 'work', label: 'Work' },
                { value: 'favorite', label: 'Other' },
              ]}
              value={kind}
              onChange={setKind}
            />
            <Pressable style={styles.pick} onPress={() => setSearchOpen(true)} accessibilityRole="button" accessibilityLabel="Search for the address">
              <Icon name="search" size={18} color="#8D95A1" />
              <Text style={[styles.pickText, !picked && { color: '#99A1AD' }]} numberOfLines={2}>
                {picked ? `${picked.name} — ${picked.address}` : 'City, area or landmark'}
              </Text>
            </Pressable>
            {kind === 'favorite' ? <TextField label="Label (optional)" value={label} onChangeText={(v) => setLabel(v.slice(0, 40))} placeholder="e.g. Hospital, College" /> : null}
            <View style={styles.row}>
              <Button title="Cancel" variant="secondary" onPress={reset} disabled={busy} style={{ flex: 1 }} />
              <Button title="Save" loading={busy} disabled={!picked} onPress={() => void save()} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}

        {savedPlaces.length === 0 && !adding ? (
          <EmptyState icon="map-pin" title="No saved addresses yet" message="Add Home and Work for one-tap booking." />
        ) : (
          <View style={styles.list}>
            {savedPlaces.map((p) => {
              const usable = isValidLatLng(p as { lat?: number; lng?: number });
              return (
                <View key={p.id} style={styles.item}>
                  <View style={styles.itemHead}>
                    <Icon name={ICON[p.type] ?? 'map-pin'} size={18} color={colors.ink} />
                    <Text style={styles.name}>{p.name}</Text>
                  </View>
                  <Text style={styles.addr} numberOfLines={2}>
                    {p.address}
                  </Text>
                  {!usable ? <Text style={styles.warn}>No map position — edit it to use it for booking.</Text> : null}
                  <View style={styles.actions}>
                    <TextButton title="Use as pickup" icon="arrow-up-right" size={11} disabled={!usable} onPress={() => pickupFrom(p)} accessibilityLabel={`Use ${p.name} as pickup`} />
                    <TextButton title="Edit" icon="pencil" size={11} onPress={() => startEdit(p)} accessibilityLabel={`Edit ${p.name}`} />
                    <View style={{ flex: 1 }} />
                    <TextButton title={deleting === p.id ? 'Removing…' : 'Delete'} icon="trash-2" size={11} color="#8A929E" disabled={deleting === p.id} onPress={() => remove(p)} accessibilityLabel={`Delete ${p.name}`} />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {!adding ? (
          <Button title="Add address" icon="plus" variant="secondary" onPress={() => setAdding('new')} style={{ marginTop: 12 }} />
        ) : null}
      </ScrollView>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  card: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, padding: 18, marginBottom: 14, backgroundColor: colors.white },
  cardTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, marginBottom: 12 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 12, marginVertical: 14, minHeight: 48 },
  pickText: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.value, flex: 1, paddingVertical: 8 },
  row: { flexDirection: 'row', gap: 10 },
  list: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, paddingHorizontal: 18, backgroundColor: colors.white },
  item: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink },
  addr: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#6D7785', marginTop: 8 },
  warn: { fontFamily: fonts.medium, fontSize: 11, color: colors.warning, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 10 },
});
