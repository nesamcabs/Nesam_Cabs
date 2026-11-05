// Every driver or vehicle request that touches this fleet: ones this vendor asked for (enter a code, wait for the office)
// and ones where another vendor is taking a record away. The server finishes them; this screen shows where each stands.
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../context/VendorData';
import { Button, EmptyState, Notice, PillTabs, Screen } from '../components/ui';
import { LinkCard } from '../components/links/LinkParts';
import { linkIsOpen } from '../services/partnerLinks';
import { colors, space, type } from '../theme';

type Tab = 'open' | 'away' | 'history';

export function RequestsScreen() {
  const navigation = useNavigation();
  const { links, profile } = useVendorData();
  const [tab, setTab] = useState<Tab>('open');
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  const open = links.filter((l) => l.toVendorId === profile.id && linkIsOpen(l));
  const away = links.filter((l) => l.fromVendorId === profile.id && l.toVendorId !== profile.id && linkIsOpen(l));
  const history = links.filter((l) => !linkIsOpen(l));
  const list = tab === 'open' ? open : tab === 'away' ? away : history;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={[]}>
      <Screen edges={[]}>
        <Text style={[type.small, { marginBottom: space.md }]}>
          Linking a driver or vehicle that is already on NESAM needs a code from the person concerned. Track every request here.
        </Text>
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        <View style={{ marginHorizontal: -space.lg }}>
          <PillTabs
            value={tab}
            onChange={setTab}
            tabs={[
              {
                id: 'open',
                label: 'Needs action',
                count: open.length,
                hot: true,
              },
              { id: 'away', label: 'Leaving my fleet', count: away.length },
              { id: 'history', label: 'History', count: history.length },
            ]}
          />
        </View>
        {list.length === 0 ? (
          <EmptyState
            title={tab === 'open' ? 'Nothing is waiting' : tab === 'away' ? 'Nobody is taking a driver or car from you' : 'No past requests'}
            message={
              tab === 'open'
                ? 'When you add a driver or car that is already on NESAM, the request and its code appear here.'
                : 'Completed and declined requests are kept here.'
            }
            action={
              tab === 'open' ? (
                <View style={{ gap: space.sm }}>
                  <Button
                    small
                    variant="secondary"
                    title="Add driver"
                    onPress={() =>
                      navigation.navigate('Tabs', {
                        screen: 'Fleet',
                        params: { tab: 'Drivers', add: Date.now() },
                      })
                    }
                  />
                  <Button
                    small
                    variant="secondary"
                    title="Add vehicle"
                    onPress={() =>
                      navigation.navigate('Tabs', {
                        screen: 'Fleet',
                        params: { tab: 'Vehicles', add: Date.now() },
                      })
                    }
                  />
                </View>
              ) : undefined
            }
          />
        ) : (
          list.map((l) => <LinkCard key={l.id} link={l} mine={l.toVendorId === profile.id} say={(text, tone = 'success') => setMessage({ tone, text })} />)
        )}
      </Screen>
    </SafeAreaView>
  );
}
