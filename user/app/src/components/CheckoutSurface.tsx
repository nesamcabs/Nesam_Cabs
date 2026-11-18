// Razorpay Checkout for one order: a WebView on the phone, an iframe in the web build (react-native-webview has no browser
// implementation). The page posts { ok … } / { dismissed } / { failed } back; a shim forwards it from the iframe to this window.
// Only messages from this surface's own frame are accepted.
import React, { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { checkoutHtml, type CheckoutLabels, type GatewayOrder } from '../services/paymentService';

export function CheckoutSurface({ order, labels, onMessage }: { order: GatewayOrder; labels: CheckoutLabels; onMessage: (raw: string) => void }) {
  const html = useMemo(() => checkoutHtml(order, labels), [order, labels]);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  }, [onMessage]);
  if (Platform.OS === 'web') return <CheckoutFrame html={html} onMessage={(m) => handler.current(m)} />;
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://checkout.razorpay.com' }}
      onMessage={(e) => handler.current(e.nativeEvent.data)}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      style={{ flex: 1, backgroundColor: '#fff' }}
    />
  );
}

function CheckoutFrame({ html, onMessage }: { html: string; onMessage: (raw: string) => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const shimmed = useMemo(() => html.replace('<head>', '<head><script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,"*")}}</script>'), [html]);
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && typeof e.data === 'string') onMessage(e.data);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onMessage]);
  return React.createElement('iframe', { ref: frame, srcDoc: shimmed, title: 'Secure payment', allow: 'payment', style: { border: 0, width: '100%', height: '100%' } });
}
