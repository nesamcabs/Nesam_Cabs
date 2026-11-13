// Live map (browser): the shared Leaflet page (mapHtml.ts) in a sandboxed iframe. react-native-webview has no web build, so
// the page talks to the app with window.postMessage instead; only messages from this map's own frame are accepted.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { nx } from '../../theme/nx';
import { buildMapHtml, type MapData } from './mapHtml';

export type { LatLng, MapData, MapLine, MapMarker } from './mapHtml';

export function LiveMap({ data, height = 300, onSelect, label = 'Map' }: { data: MapData; height?: number; onSelect?: (id: string) => void; label?: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => buildMapHtml(), []);
  const payload = JSON.stringify(data);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const x = e.data as { __nesamMap?: boolean; payload?: string } | null;
      if (!x?.__nesamMap || typeof x.payload !== 'string') return;
      try {
        const msg = JSON.parse(x.payload) as { type?: string; id?: string };
        if (msg.type === 'ready') setReady(true);
        else if (msg.type === 'error') setFailed(true);
        else if (msg.type === 'select' && msg.id) select.current?.(msg.id);
      } catch {
        /* not ours */
      }
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ __nesamMapData: true, data: JSON.parse(payload) }, '*');
  }, [ready, payload]);

  return (
    <View style={[styles.wrap, { height }]} accessibilityLabel={label}>
      {React.createElement('iframe', {
        ref: frame,
        srcDoc: html,
        title: label,
        sandbox: 'allow-scripts',
        style: { border: 0, width: '100%', height: '100%', display: 'block', background: '#EEF0F3' },
      })}
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
  off: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#EEF0F3' },
  offText: { fontSize: 12.5, color: nx.muted, textAlign: 'center' },
});
