// The agreements this partner accepted, with version and time. The text is shown only while the accepted version is still the
// one in force; otherwise the office can supply the exact copy.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useVendorData } from '../context/VendorData';
import { Button, Card, EmptyState, Notice, Screen, Sheet } from '../components/ui';
import { currentTextOf, subscribeToMyAcceptances, type Acceptance } from '../services/agreements';
import { formatDateTime12 } from '../utils/time';
import { space, type } from '../theme';

export function AgreementsScreen() {
  const { profile } = useVendorData();
  const [list, setList] = useState<Acceptance[] | null>(null);
  const [view, setView] = useState<{
    a: Acceptance;
    body: string;
    current: boolean;
  } | null>(null);
  const [loading, setLoading] = useState('');

  useEffect(() => subscribeToMyAcceptances(profile.id, setList, () => setList([])), [profile.id]);

  const open = async (a: Acceptance) => {
    setLoading(a.id);
    try {
      setView({ a, ...(await currentTextOf(a)) });
    } catch {
      setView({ a, body: '', current: false });
    } finally {
      setLoading('');
    }
  };

  return (
    <Screen edges={[]}>
      {list === null ? <Text style={type.small}>Loading…</Text> : null}
      {list?.length === 0 ? (
        <EmptyState
          title="No agreements recorded yet"
          message="When NESAM publishes terms for fleet partners, the ones you accept are listed here with the version and time."
        />
      ) : null}
      {list?.map((a) => (
        <Card key={a.id}>
          <Text style={type.h3}>{a.title}</Text>
          <Text style={[type.small, { marginBottom: space.sm }]}>
            Version {a.version} · accepted {a.acceptedAt ? formatDateTime12(a.acceptedAt) : '—'}
          </Text>
          <Button small variant="secondary" title="Read" loading={loading === a.id} onPress={() => void open(a)} />
        </Card>
      ))}
      {view ? (
        <Sheet visible onClose={() => setView(null)} title={view.a.title}>
          <Text style={[type.tiny, { marginBottom: space.md }]}>
            Version {view.a.version} · accepted {view.a.acceptedAt ? formatDateTime12(view.a.acceptedAt) : ''}
          </Text>
          {view.current && view.body ? (
            <View>
              <Text style={type.body}>{view.body}</Text>
            </View>
          ) : (
            <Notice
              tone="warning"
              message="This is not the version in force any more, so its text is not shown here. The NESAM office can send you the exact copy you accepted."
            />
          )}
          <Button title="Close" onPress={() => setView(null)} style={{ marginTop: space.md }} />
        </Sheet>
      ) : null}
    </Screen>
  );
}
