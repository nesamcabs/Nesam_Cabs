// Live map (Android / iOS): the shared Leaflet page (mapHtml.ts) inside a WebView. No Maps SDK key is needed. Taps on a pin
// come back through onSelect; new data is pushed into the page without reloading it, so the map never flickers on refresh.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Text } from './Text';
import { nx } from '../../theme/nx';
import { buildMapHtml, type MapData } from './mapHtml';

export type { LatLng, MapData, MapLine, MapMarker } from './mapHtml';

export function LiveMap({ data, height = 300, onSelect, label = 'Map' }: { data: MapData; height?: number; onSelect?: (id: string) => void; label?: string }) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => buildMapHtml(), []);
  const payload = JSON.stringify(data);

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.__update && window.__update(${payload});true;`);
  }, [ready, payload]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type?: string; id?: string };
      if (msg.type === 'ready') setReady(true);
      else if (msg.type === 'error') setFailed(true);
      else if (msg.type === 'select' && msg.id) onSelect?.(msg.id);
    } catch {
      /* not ours */
    }
  };

  return (
    <View style={[styles.wrap, { height }]} accessibilityLabel={label}>
      <WebView
        ref={ref}
        source={{ html, baseUrl: 'https://nesam.local/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        nestedScrollEnabled
        style={styles.web}
        onError={() => setFailed(true)}
      />
      {failed ? (
        <View style={styles.off} pointerEvents="none">
          <Text style={styles.offText}>The map could not load. The order list below still works.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: nx.line, backgroundColor: '#EEF0F3' },
  web: { flex: 1, backgroundColor: '#EEF0F3' },
  off: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#EEF0F3' },
  offText: { fontSize: 12.5, color: nx.muted, textAlign: 'center' },
});
