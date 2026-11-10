// The NESAM AI travel assistant, as a full-height sheet. Same booking-server function (`chatWithBot`) and the same
// greeting, language switch and quick questions as the website's chat, so an answer never differs between app and site.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { callFunction } from '../services/callables';
import { isOnline } from '../utils/network';
import { colors, fonts, radius, space } from '../theme';

type Lang = 'en' | 'ta';
interface Msg { id: string; role: 'user' | 'assistant'; content: string; local?: boolean }

const WELCOME: Record<Lang, string> = {
  en: "Hello! Welcome to NESAM Cabs. I'm your AI travel guide.\n\nI can help with:\n• One-way drop fares: pay for one way, not the return\n• Round trips, airport rides and city rentals\n• Choosing the right cab: Sedan, SUV, Innova Crysta, vans\n• Upfront fares and our policies\n\nHow can I help you today?",
  ta: 'வணக்கம்! NESAM Cabs க்கு வரவேற்கிறோம். நான் உங்கள் AI பயண வழிகாட்டி.\n\nநான் உதவக்கூடியவை:\n• ஒருவழி டிராப் கட்டணம்: ஒரு வழிக்கான கட்டணம் மட்டுமே\n• சுற்றுப் பயணம், விமான நிலையம், உள்ளூர் வாடகை\n• சரியான காரைத் தேர்வு செய்ய: Sedan, SUV, Innova Crysta, வேன்\n• முன்கூட்டியே தெரியும் கட்டணம், எங்கள் கொள்கைகள்\n\nஇன்று நான் எப்படி உதவலாம்?',
};
const PROMPTS: Record<Lang, string[]> = {
  en: ['How do one-way fares work?', 'What car types are available?', 'What is the cancellation policy?', 'How do I book an airport taxi?', 'Do you offer Multicity trips?'],
  ta: ['ஒருவழி கட்டணம் எப்படி?', 'என்ன கார்கள் உள்ளன?', 'ரத்து கொள்கை என்ன?', 'விமான நிலைய டாக்ஸி புக்கிங்', 'Multicity பயணங்கள் உண்டா?'],
};
const TEXT = {
  en: { title: 'NESAM Travel Advisor', placeholder: 'Ask about fares, cabs, routes…', offline: 'You’re offline. Connect to the internet to chat.', fail: 'Sorry, I couldn’t answer just now. Please try again or call us.', busy: 'Lots of people are chatting right now. Please try again in a minute.', send: 'Send', close: 'Close chat' },
  ta: { title: 'NESAM பயண ஆலோசகர்', placeholder: 'கட்டணம், கார், வழி பற்றிக் கேளுங்கள்…', offline: 'இணைய இணைப்பு இல்லை. இணைத்த பிறகு முயற்சிக்கவும்.', fail: 'மன்னிக்கவும், இப்போது பதில் அளிக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது அழைக்கவும்.', busy: 'இப்போது நிறையப் பேர் பேசுகிறார்கள். ஒரு நிமிடம் கழித்து முயற்சிக்கவும்.', send: 'அனுப்பு', close: 'அரட்டையை மூடு' },
} as const;

export function AiChatSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [lang, setLang] = useState<Lang>('en');
  const [messages, setMessages] = useState<Msg[]>([{ id: 'welcome', role: 'assistant', content: WELCOME.en, local: true }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const list = useRef<FlatList<Msg>>(null);
  const t = TEXT[lang];

  useEffect(() => {
    list.current?.scrollToEnd({ animated: true });
  }, [messages.length, loading]);

  const chooseLang = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    // Until the rider has said something, the greeting follows the language.
    setMessages((cur) => (cur.length === 1 && cur[0]!.id === 'welcome' ? [{ ...cur[0]!, content: WELCOME[next] }] : cur));
  };

  const send = useCallback(
    async (text?: string) => {
      const q = (text ?? input).trim();
      if (!q || loading) return;
      const history: Msg[] = [...messages, { id: `u_${Date.now()}`, role: 'user', content: q }];
      setMessages(history);
      setInput('');
      const reply = (content: string, local = false) => setMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content, local }]);
      if (!isOnline()) return reply(t.offline, true);
      setLoading(true);
      try {
        const res = await callFunction<{ brand: string; language: Lang; messages: { role: 'user' | 'assistant'; content: string }[] }, { message: string; provider: string }>(
          'chatWithBot',
          {
            brand: 'nesam',
            language: lang,
            // The greeting is scripted, not part of the conversation.
            messages: history.filter((m) => m.id !== 'welcome' && !m.local).slice(-20).map((m) => ({ role: m.role, content: m.content })),
          },
        );
        reply(res?.message || t.fail, res?.provider !== 'groq');
      } catch (err) {
        const code = (err as { code?: string })?.code ?? '';
        reply(code.includes('resource-exhausted') ? t.busy : t.fail, true);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, lang, t],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.head}>
            <View style={styles.avatar}>
              <Icon name="message-circle" size={18} color={colors.white} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
              <Text style={styles.status}>● Online</Text>
            </View>
            <View style={styles.langs}>
              {(['en', 'ta'] as const).map((l) => (
                <Pressable key={l} onPress={() => chooseLang(l)} accessibilityRole="button" accessibilityState={{ selected: lang === l }} style={[styles.lang, lang === l && styles.langOn]}>
                  <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l === 'en' ? 'EN' : 'தமிழ்'}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t.close} hitSlop={8} style={styles.close}>
              <Icon name="x" size={20} color={colors.white} strokeWidth={2.2} />
            </Pressable>
          </View>

          <FlatList
            ref={list}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.role === 'user' ? styles.user : styles.bot]}>
                <Text style={[styles.bubbleText, item.role === 'user' && { color: colors.white }]} selectable>{item.content.replace(/\*\*/g, '')}</Text>
              </View>
            )}
            ListFooterComponent={
              <View>
                {loading ? (
                  <View style={[styles.bubble, styles.bot, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.bubbleText}>…</Text>
                  </View>
                ) : null}
                {messages.length === 1 ? (
                  <View style={styles.prompts}>
                    {PROMPTS[lang].map((p) => (
                      <Pressable key={p} onPress={() => void send(p)} accessibilityRole="button" style={styles.prompt}>
                        <Text style={styles.promptText}>{p}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            }
          />

          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t.placeholder}
              placeholderTextColor={colors.faint}
              style={styles.input}
              multiline
              maxLength={500}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => void send()}
              accessibilityLabel={t.placeholder}
            />
            <Pressable onPress={() => void send()} disabled={!input.trim() || loading} accessibilityRole="button" accessibilityLabel={t.send} style={[styles.send, (!input.trim() || loading) && { opacity: 0.4 }]}>
              <Icon name="send" size={18} color={colors.white} strokeWidth={2.2} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primary, paddingHorizontal: space.lg, paddingVertical: 12 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white },
  status: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.85)' },
  langs: { flexDirection: 'row', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.2)', padding: 2 },
  lang: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  langOn: { backgroundColor: colors.white },
  langText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.white },
  langTextOn: { color: colors.primary },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: 10, flexGrow: 1 },
  bubble: { maxWidth: '86%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14 },
  bot: { alignSelf: 'flex-start', backgroundColor: colors.subtle, borderBottomLeftRadius: 4 },
  user: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.text },
  prompts: { gap: 8, marginTop: 6, alignItems: 'flex-start' },
  prompt: { borderWidth: 1, borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 8 },
  promptText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: space.md, borderTopWidth: 1, borderTopColor: colors.divider },
  input: { flex: 1, minHeight: 44, maxHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15, color: colors.value },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
