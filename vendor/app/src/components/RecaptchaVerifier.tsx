// Native application verifier for Firebase phone auth.
//
// The Firebase JS SDK (React Native build) asks its ApplicationVerifier for a
// reCAPTCHA v2 token before it sends the SMS. Browsers render that widget in
// the DOM; on Android we host Google's reCAPTCHA in a WebView whose origin is
// this project's authorised authDomain, and hand the token back to the SDK.
// Only Google / Firebase hosts may load inside it; it is a verification step,
// not an app screen.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { firebaseConfig } from '../config/firebase';
import { colors, radius, space, type } from '../theme';

const SDK_VERSION = '12.19.0';
const VERIFY_TIMEOUT_MS = 120000;
const ALLOWED_HOSTS = [/(^|\.)google\.com$/, /(^|\.)gstatic\.com$/, /(^|\.)firebaseapp\.com$/, /(^|\.)googleapis\.com$/, /(^|\.)recaptcha\.net$/];

export interface NativeRecaptchaVerifier {
  readonly type: 'recaptcha';
  verify(): Promise<string>;
  _reset(): void;
}

export class RecaptchaError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function buildHtml(): string {
  const config = JSON.stringify({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
  });
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;font-family:sans-serif}#c{margin-top:24px}</style>
<script src="https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js"></script>
<script>
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
function start(){
  try{
    firebase.initializeApp(${config});
    var v = new firebase.auth.RecaptchaVerifier('c', {
      size: 'invisible',
      'expired-callback': function(){ post({type:'expired'}); }
    });
    v.render().then(function(){ return v.verify(); })
      .then(function(token){ post({type:'token', token: token}); })
      .catch(function(e){ post({type:'error', message: String((e && (e.code || e.message)) || e)}); });
  }catch(e){ post({type:'error', message: String(e && e.message || e)}); }
}
window.onload = start;
</script></head><body><div id="c"></div></body></html>`;
}

type Pending = { resolve: (token: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const RecaptchaContext = createContext<NativeRecaptchaVerifier | null>(null);

export function useRecaptchaVerifier(): NativeRecaptchaVerifier {
  const v = useContext(RecaptchaContext);
  if (!v) throw new Error('RecaptchaProvider is missing');
  return v;
}

export function RecaptchaProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const pending = useRef<Pending | null>(null);

  const settle = useCallback((result: { token?: string; error?: RecaptchaError }) => {
    const p = pending.current;
    pending.current = null;
    setVisible(false);
    if (!p) return;
    clearTimeout(p.timer);
    if (result.token) p.resolve(result.token);
    else p.reject(result.error ?? new RecaptchaError('auth/captcha-check-failed', 'Security check failed.'));
  }, []);

  const verifier = useMemo<NativeRecaptchaVerifier>(
    () => ({
      type: 'recaptcha',
      verify: () =>
        new Promise<string>((resolve, reject) => {
          // Only one challenge at a time; a newer request supersedes an old one.
          if (pending.current) {
            clearTimeout(pending.current.timer);
            pending.current.reject(new RecaptchaError('auth/captcha-check-failed', 'Security check was restarted.'));
          }
          const timer = setTimeout(
            () => settle({ error: new RecaptchaError('auth/timeout', 'The security check timed out. Please try again.') }),
            VERIFY_TIMEOUT_MS,
          );
          pending.current = { resolve, reject, timer };
          setSessionKey((k) => k + 1);
          setVisible(true);
        }),
      _reset: () => undefined,
    }),
    [settle],
  );

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; token?: string; message?: string };
      if (msg.type === 'token' && msg.token) settle({ token: msg.token });
      else if (msg.type === 'expired') settle({ error: new RecaptchaError('auth/captcha-check-failed', 'The security check expired. Please try again.') });
      else if (msg.type === 'error') settle({ error: new RecaptchaError('auth/captcha-check-failed', 'The security check could not be completed. Check your connection and try again.') });
    } catch {
      // Ignore messages that are not ours.
    }
  };

  const cancel = () => settle({ error: new RecaptchaError('auth/cancelled', 'Verification cancelled.') });

  return (
    <RecaptchaContext.Provider value={verifier}>
      {children}
      <Modal visible={visible} animationType="fade" transparent onRequestClose={cancel}>
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.panel} edges={['bottom']}>
            <View style={styles.header}>
              <Text style={type.h3}>Quick security check</Text>
              <Pressable onPress={cancel} accessibilityRole="button" hitSlop={12}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.sub}>Confirming you’re not a robot before we send your OTP. Solve the puzzle if one appears.</Text>
            <View style={styles.webWrap}>
              {visible ? (
                <WebView
                  key={sessionKey}
                  originWhitelist={['https://*']}
                  source={{ html: buildHtml(), baseUrl: `https://${firebaseConfig.authDomain}` }}
                  onMessage={onMessage}
                  javaScriptEnabled
                  domStorageEnabled
                  mixedContentMode="never"
                  setSupportMultipleWindows={false}
                  startInLoadingState
                  renderLoading={() => (
                    <View style={styles.loading}>
                      <ActivityIndicator color={colors.primary} />
                    </View>
                  )}
                  onShouldStartLoadWithRequest={(req) => {
                    if (req.url === 'about:blank' || req.url.startsWith('data:')) return true;
                    try {
                      const host = new URL(req.url).hostname;
                      if (ALLOWED_HOSTS.some((re) => re.test(host))) return true;
                    } catch {
                      return false;
                    }
                    void Linking.openURL(req.url);
                    return false;
                  }}
                  onError={() =>
                    settle({ error: new RecaptchaError('auth/network-request-failed', 'Network connection failed. Please check your internet.') })
                  }
                />
              ) : null}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </RecaptchaContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  panel: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, height: '78%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cancel: { color: colors.muted, fontWeight: '700' },
  sub: { ...type.small, marginTop: 4, marginBottom: space.md },
  webWrap: { flex: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
