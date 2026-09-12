import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import { ReplyBody } from './src/ReplyBody';
import { conversationText, getOptions, messageText, rememberRequest, type ReplyOptions } from './src/preferences';
import { Attachment, attachmentMime, Conversation, MAX_FILES, Message, restoreConversations, validateAttachments } from './src/chat';
import { checkServer, generateImage, removeGeneratedImage, streamChat } from './src/api';
import { colors as color, markdownStyles, styles } from './src/styles';
import { withAbort } from './src/requests';

const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://chatbot-kr7o.onrender.com';
const HISTORY_KEY = 'jay-ai:chats:v1';
const SERVER_KEY = 'jay-ai:server:v1';
const id = () => Crypto.randomUUID();
const newConversation = (): Conversation => ({ id: id(), title: 'New chat', messages: [], updatedAt: Date.now() });
type IconName = React.ComponentProps<typeof Ionicons>['name'];

function IconButton({ icon, label, onPress, disabled = false }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, (pressed || disabled) && styles.dim]}><Ionicons name={icon} size={23} color={color.ink} /></Pressable>;
}

function AppContent() {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 900 && fontScale < 1.6;
  const chatWidth = Math.max(0, width - insets.left - insets.right - (wide ? 290 : 0));
  const compact = height < 500;
  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [imageMode, setImageMode] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [serverDraft, setServerDraft] = useState(DEFAULT_URL);
  const [checking, setChecking] = useState(false);
  const [serverNotice, setServerNotice] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const pickingRef = useRef(false);
  const listRef = useRef<FlatList<Message>>(null);
  const followReply = useRef(true);
  const writeQueue = useRef(Promise.resolve());
  const current = chats.find(chat => chat.id === activeId) ?? chats[0];
  const preferences = getOptions(current?.preferences);
  const locked = busy || picking;

  useEffect(() => {
    let mounted = true;
    (async () => {
      let saved: Conversation[] = [];
      try {
        const [history, url] = await Promise.all([AsyncStorage.getItem(HISTORY_KEY), AsyncStorage.getItem(SERVER_KEY)]);
        saved = restoreConversations(history);
        if (mounted && url) { setServerUrl(url); setServerDraft(url); }
      } catch { if (mounted) setError('Some saved chats could not be loaded. You can still start a new chat.'); }
      if (!saved.length) saved = [newConversation()];
      if (mounted) { setChats(saved); setActiveId(saved[0].id); setReady(true); }
    })();
    return () => { mounted = false; requestRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!ready || busy) return;
    const timer = setTimeout(() => {
      writeQueue.current = writeQueue.current.catch(() => undefined).then(() => AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(chats))).catch(() => setError('Device storage is full. Recent chats could not be saved.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [chats, ready, busy]);

  function startChat() {
    if (locked) return;
    setImageMode(false);
    const chat = newConversation();
    setChats(previous => [chat, ...previous]); setActiveId(chat.id);
    setDraft(''); setAttachments([]); setError(null); setHistoryOpen(false); followReply.current = true;
  }
  function selectChat(chat: Conversation) {
    if (locked) return;
    setImageMode(false);
    setActiveId(chat.id); setDraft(''); setAttachments([]); setError(null); setHistoryOpen(false); followReply.current = true;
  }
  function deleteChat(chat: Conversation) {
    if (locked) return;
    Alert.alert('Delete this chat?', 'This removes the saved conversation from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        for (const message of chat.messages) {
          if (message.image) {
            try { removeGeneratedImage(message.image.uri); }
            catch { setError('The chat was deleted, but an image file could not be removed from device storage.'); }
          }
        }
        const remaining = chats.filter(item => item.id !== chat.id);
        if (!remaining.length) remaining.push(newConversation());
        setChats(remaining);
        if (activeId === chat.id) { setActiveId(remaining[0].id); setDraft(''); setAttachments([]); }
      } },
    ]);
  }

  async function pickFiles(source: 'files' | 'photos' | 'camera') {
    if (requestRef.current || pickingRef.current) return;
    if (imageMode) { setError('Switch to Chat to attach files. Create image uses a text description.'); return; }
    if (attachments.length >= MAX_FILES) { setError('You can attach up to 10 files per message.'); return; }
    pickingRef.current = true; setPicking(true); setError(null);
    try {
      const selected: Attachment[] = [];
      if (source !== 'files') {
        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open settings', onPress: () => { void Linking.openSettings(); } },
            ]);
            return;
          }
        }
        const result = source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_FILES - attachments.length, quality: 1 });
        if (result.canceled) return;
        if (result.assets.length + attachments.length > MAX_FILES) throw new Error('You can attach up to 10 files per message.');
        for (const asset of result.assets) {
          // Normalize phone photos (including HEIC) for OCR and limit memory use.
          const context = ImageManipulator.manipulate(asset.uri);
          if (Math.max(asset.width, asset.height) > 2400) context.resize(asset.width >= asset.height ? { width: 2400 } : { height: 2400 });
          const rendered = await context.renderAsync();
          const output = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
          const file = new File(output.uri);
          selected.push({ id: id(), name: `${(asset.fileName ?? 'photo').replace(/\.[^.]+$/, '')}.jpg`, mimeType: 'image/jpeg', uri: output.uri, size: file.size });
        }
      } else {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
        if (result.canceled) return;
        if (result.assets.length + attachments.length > MAX_FILES) throw new Error('You can attach up to 10 files per message.');
        for (const asset of result.assets) selected.push({ id: id(), name: asset.name, mimeType: attachmentMime(asset.name, asset.mimeType), uri: asset.uri, size: new File(asset.uri).size });
      }
      validateAttachments([...attachments, ...selected]);
      setAttachments(previous => [...previous, ...selected]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The selected files could not be read.'); }
    finally { pickingRef.current = false; setPicking(false); }
  }

  async function send() {
    if (requestRef.current || pickingRef.current || !current || (!draft.trim() && !attachments.length)) return;
    if (imageMode && (!draft.trim() || draft.trim().length > 2048 || attachments.length)) {
      setError('Describe your image using 1–2048 characters, without attachments.'); return;
    }
    const text = draft.trim(); const files = attachments; const chatId = current.id;
    const requestPreferences = rememberRequest(text, preferences);
    const userId = id(); const assistantId = id();
    const controller = new AbortController(); requestRef.current = controller;
    setActiveReplyId(assistantId);
    setBusy(true); setError(null); setDraft(''); setAttachments([]); followReply.current = true;
    setChats(previous => previous.map(chat => chat.id !== chatId ? chat : {
      ...chat, preferences: requestPreferences, title: chat.messages.length ? chat.title : (text || files[0].name).slice(0, 48), updatedAt: Date.now(),
      messages: [...chat.messages, { id: userId, role: 'user', content: text, attachments: files.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })) }, { id: assistantId, role: 'assistant', content: '' }],
    }));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
    try {
      if (imageMode) {
        const image = await withAbort(generateImage(serverUrl, text, assistantId, controller.signal), controller.signal);
        setChats(previous => previous.map(chat => chat.id !== chatId ? chat : { ...chat, messages: chat.messages.map(message => message.id === assistantId ? { ...message, content: 'Generated image', image } : message) }));
        return;
      }
      await withAbort(streamChat({ url: serverUrl, conversationId: chatId, message: text, attachments: files, signal: controller.signal, preferences: requestPreferences,
        onDelta: delta => { if (!controller.signal.aborted) setChats(previous => previous.map(chat => chat.id !== chatId ? chat : { ...chat, messages: chat.messages.map(message => message.id === assistantId ? { ...message, content: message.content + delta } : message) })); },
      }), controller.signal);
    } catch (caught) {
      // Restore the turn and all files for retry instead of losing the user's draft.
      setChats(previous => previous.map(chat => chat.id !== chatId ? chat : { ...chat, messages: chat.messages.filter(message => message.id !== userId && message.id !== assistantId) }));
      setDraft(text); setAttachments(files);
      setError(timedOut ? 'The server took too long. Your message and files are ready to retry.' : controller.signal.aborted ? 'Stopped. Your message and files are ready to retry.' : caught instanceof Error ? caught.message : 'Could not connect. Check your connection and try again.');
    } finally { clearTimeout(timer); requestRef.current = null; setBusy(false); setActiveReplyId(null); }
  }

  async function saveServer() {
    if (checking) return;
    setChecking(true); setServerNotice('Connecting…');
    try {
      const url = await checkServer(serverDraft);
      await AsyncStorage.setItem(SERVER_KEY, url);
      setServerUrl(url); setServerDraft(url); setServerNotice('Connected. Your server is ready.');
    } catch { setServerNotice('Could not connect. Check the URL and try again. A sleeping server may need a moment to wake up.'); }
    finally { setChecking(false); }
  }

  function updatePreferences(patch: Partial<ReplyOptions>) {
    if (locked || !current) return;
    setChats(previous => previous.map(chat => chat.id === current.id ? { ...chat, preferences: { ...getOptions(chat.preferences), ...patch } } : chat));
  }
  async function copyText(text: string) {
    try {
      if (!await Clipboard.setStringAsync(text)) throw new Error('Clipboard unavailable');
      setNotice('Copied to clipboard.');
    } catch { setError('Could not copy text. Try selecting the text manually.'); }
  }
  async function shareConversation() {
    if (!current) return;
    const text = conversationText(current);
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.share) await navigator.share({ title: current.title, text });
        else { await copyText(text); setNotice('Sharing is unavailable in this browser. Conversation copied instead.'); }
      } else await Share.share({ title: current.title, message: text });
    } catch (caught) { if (!(caught instanceof Error && caught.name === 'AbortError')) setError('Could not open sharing. Use Copy conversation instead.'); }
  }

  function retryReply(messageId: string) {
    if (locked || !current) return;
    const index = current.messages.findIndex(message => message.id === messageId);
    const original = current.messages.slice(0, index).reverse().find(message => message.role === 'user');
    if (!original) return;
    setDraft(original.content);
    setError(original.attachments?.length ? 'Please attach the original files again before retrying.' : null);
  }

  function sidebar() {
    return <View style={styles.sidebar}>
      <View style={styles.sideHeader}><Text style={styles.brand}>JAY AI</Text>{!wide && <IconButton icon="close" label="Close chat history" onPress={() => setHistoryOpen(false)} />}</View>
      <Pressable accessibilityRole="button" disabled={locked} onPress={startChat} style={[styles.newChat, locked && styles.dim]}><Ionicons name="add" size={21} color={color.accent} /><Text style={styles.newChatText}>New conversation</Text></Pressable>
      <Text style={styles.sectionLabel}>YOUR CONVERSATIONS</Text>
      <FlatList data={[...chats].sort((a, b) => b.updatedAt - a.updatedAt)} keyExtractor={chat => chat.id} contentContainerStyle={{ gap: 6, paddingBottom: 16 }} renderItem={({ item }) => <View style={[styles.chatRow, item.id === current?.id && styles.chatRowActive]}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: item.id === current?.id, disabled: locked }} disabled={locked} style={styles.chatSelect} onPress={() => selectChat(item)}><Text numberOfLines={2} style={styles.chatTitle}>{item.title}</Text><Text style={styles.chatDate}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text></Pressable>
        <IconButton icon="trash-outline" label={`Delete ${item.title}`} disabled={locked} onPress={() => deleteChat(item)} />
      </View>} />
      <Text style={styles.sidebarNote}>A little help, wherever you are.</Text><Text style={styles.storageNote}>Chats are saved on this device.</Text>
    </View>;
  }

  if (!ready) return <SafeAreaView style={styles.loading}><ActivityIndicator color={color.accent} /><Text style={styles.muted}>Opening your chats…</Text></SafeAreaView>;
  const sendDisabled = !busy && (picking || (!draft.trim() && !attachments.length));
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
    <StatusBar style="dark" />
    <View style={styles.layout}>
      {wide && <View style={styles.sidebarDesktop}>{sidebar()}</View>}
      <KeyboardAvoidingView style={[styles.main, { width: chatWidth, maxWidth: chatWidth }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          {!wide && <IconButton icon="menu-outline" label="Open chat history" disabled={locked} onPress={() => setHistoryOpen(true)} />}
          <View style={styles.headerTitle}><Text style={styles.brand}>JAY AI</Text><Text style={styles.headerSubtitle} numberOfLines={1}>{current?.messages.length ? current.title : 'Your everyday thinking companion'}</Text></View>
          <IconButton icon="create-outline" label="New conversation" disabled={locked} onPress={startChat} />
          <IconButton icon="options-outline" label="Connection settings" disabled={locked} onPress={() => { setServerDraft(serverUrl); setServerNotice(''); setSettingsOpen(true); }} />
          <IconButton icon="ellipsis-vertical" label="Conversation options" disabled={locked} onPress={() => setOptionsOpen(true)} />
        </View>
        <FlatList key={current?.id} ref={listRef} data={current?.messages ?? []} keyExtractor={message => message.id} style={styles.messageList}
          contentContainerStyle={[styles.messageContent, !current?.messages.length && styles.emptyContent]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; followReply.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100; }} scrollEventThrottle={100}
          onContentSizeChange={() => { if (followReply.current) listRef.current?.scrollToEnd({ animated: false }); }}
          ListEmptyComponent={<View style={[styles.welcome, compact && { paddingVertical: 12 }]}>
            {!compact && <View style={styles.welcomeMark}><Ionicons name="sparkles-outline" color={color.accent} size={34} /></View>}
            <Text style={[styles.welcomeTitle, width < 380 && { fontSize: 29 }]}>A fresh thought starts here.</Text>
            <Text style={styles.welcomeText}>Ask a question, work through an idea,{compact ? ' ' : '\n'}or bring a few files along.</Text>
            {!compact && <View style={styles.suggestions}>{[
              ['bulb-outline', 'Think it through', 'Help me think through an idea.'],
              ['document-text-outline', 'Make sense of a file', 'Summarize the files I attach and highlight the main points.'],
              ['pencil-outline', 'Find the right words', 'Help me write something clearly and naturally.'],
            ].map(([icon, label, prompt]) => <Pressable key={label} accessibilityRole="button" onPress={() => setDraft(prompt)} style={({ pressed }) => [styles.suggestion, pressed && styles.dim]}><Ionicons name={icon as IconName} color={color.accent} size={20} /><Text style={styles.suggestionText}>{label}</Text><Ionicons name="arrow-forward" color={color.muted} size={17} /></Pressable>)}</View>}
          </View>}
          renderItem={({ item }) => <View style={[styles.message, item.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
            {item.role === 'assistant' && <Text style={styles.replyLabel}>JAY AI</Text>}
            {item.image && <Image source={{ uri: item.image.uri }} accessibilityLabel={`Generated image: ${item.image.prompt}`} resizeMode="contain" style={{ width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: color.soft }} onError={() => setError('This saved image could not be opened. You can generate it again from its description.')} />}
            {item.role === 'assistant' ? item.content ? <ReplyBody content={item.content} format={preferences.format} onError={setError} /> : busy && item.id === activeReplyId ? <View style={styles.thinking}><ActivityIndicator size="small" color={color.accent} /><Text style={styles.muted}>{imageMode ? 'Creating image…' : 'Thinking…'}</Text></View> : !item.image ? <View><Text style={styles.muted}>This reply was interrupted or returned empty.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry message" disabled={locked} onPress={() => retryReply(item.id)} style={styles.attachButton}><Text style={styles.toolText}>Retry message</Text></Pressable></View> : null : item.content ? <Text selectable style={styles.userText}>{item.content}</Text> : null}
            {item.attachments?.map(file => <View key={file.id} style={styles.sentFile}><Ionicons name="document-attach-outline" size={17} color={color.accent} /><Text style={styles.sentFileName}>{file.name}</Text></View>)}
            {!!item.content && item.id !== activeReplyId && <Pressable accessibilityRole="button" accessibilityLabel={item.role === 'assistant' ? 'Copy reply' : 'Copy message'} onPress={() => void copyText(messageText(item))} style={styles.attachButton}><Ionicons name="copy-outline" color={color.accent} size={16} /><Text style={styles.toolText}>Copy</Text></Pressable>}
          </View>} />
        <View style={styles.composerOuter}>
          {!!notice && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notice" onPress={() => setNotice('')}><Text accessibilityLiveRegion="polite" style={styles.storageNote}>{notice}</Text></Pressable>}
          {busy && <Pressable accessibilityRole="button" accessibilityLabel="Stop request" onPress={() => requestRef.current?.abort()} style={styles.attachButton}><Ionicons name="stop-circle-outline" color={color.accent} size={22} /><Text style={styles.toolText}>{imageMode ? 'Stop creating image' : 'Stop response'}</Text></Pressable>}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
            {(['Chat', 'Create image'] as const).map((label, index) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: imageMode === Boolean(index), disabled: locked || (index === 1 && attachments.length > 0) }} disabled={locked || (index === 1 && attachments.length > 0)} onPress={() => { setImageMode(Boolean(index)); setError(null); }} style={[styles.attachButton, imageMode === Boolean(index) && { backgroundColor: color.soft, borderRadius: 12 }, locked && styles.dim]}><Ionicons name={index ? 'color-palette-outline' : 'chatbubble-outline'} size={18} color={color.accent} /><Text style={styles.toolText}>{label}</Text></Pressable>)}
          </View>
          {imageMode && <Text style={styles.storageNote}>Describe an image to create. Up to 2,048 characters.</Text>}
          {error && <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text><IconButton icon="close" label="Dismiss message" onPress={() => setError(null)} /></View>}
          {attachments.length > 0 && <ScrollView horizontal style={styles.pendingList} contentContainerStyle={{ gap: 8 }} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">{attachments.map(file => <View key={file.id} style={styles.pendingFile}>
            {file.mimeType.startsWith('image/') ? <Image source={{ uri: file.uri }} style={styles.thumbnail} /> : <Ionicons name="document-text-outline" color={color.accent} size={23} />}
            <View style={{ flexShrink: 1 }}><Text style={styles.fileName} numberOfLines={1}>{file.name}</Text><Text style={styles.fileSize}>{(file.size / 1024).toFixed(0)} KB</Text></View>
            <IconButton icon="close-circle-outline" label={`Remove ${file.name}`} disabled={locked} onPress={() => setAttachments(previous => previous.filter(item => item.id !== file.id))} />
          </View>)}</ScrollView>}
          <View style={styles.composer}>
            <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} editable={!busy} placeholder="Ask anything, or add a file…" placeholderTextColor={color.muted} multiline style={[styles.input, { maxHeight: compact ? 65 : 140 }]} textAlignVertical="top" />
            <View style={styles.composerTools}>
              <Pressable accessibilityRole="button" accessibilityLabel="Attach documents" disabled={locked} onPress={() => void pickFiles('files')} style={[styles.attachButton, locked && styles.dim]}><Ionicons name="attach" size={23} color={color.accent} /><Text style={styles.toolText}>Files</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Attach photos" disabled={locked} onPress={() => void pickFiles('photos')} style={[styles.attachButton, locked && styles.dim]}><Ionicons name="images-outline" size={21} color={color.accent} /><Text style={styles.toolText}>Photos</Text></Pressable>
              <IconButton icon="camera-outline" label="Take a photo" disabled={locked} onPress={() => void pickFiles('camera')} />
              <View style={{ flex: 1 }} />{picking && <ActivityIndicator color={color.accent} size="small" />}
              <Pressable accessibilityRole="button" accessibilityLabel={busy ? 'Stop response' : 'Send message'} accessibilityState={{ disabled: sendDisabled }} disabled={sendDisabled} onPress={() => busy ? requestRef.current?.abort() : void send()} style={({ pressed }) => [styles.send, (sendDisabled || pressed) && styles.dim]}><Ionicons name={busy ? 'stop' : 'arrow-up'} color="white" size={22} /></Pressable>
            </View>
          </View>
          {!compact && <Text style={styles.composerHint}>{attachments.length ? `${attachments.length}/10 files · ` : ''}Up to 10 files · 5 MB each · 20 MB total</Text>}
        </View>
      </KeyboardAvoidingView>
    </View>
    <Modal visible={historyOpen && !wide} transparent animationType="fade" onRequestClose={() => setHistoryOpen(false)}><View style={styles.modalOverlay}><Pressable accessibilityLabel="Close chat history" onPress={() => setHistoryOpen(false)} style={StyleSheet.absoluteFill} /><SafeAreaView style={[styles.historySheet, { width: Math.min(width - 32, 360) }]}>{sidebar()}</SafeAreaView></View></Modal>
    <Modal visible={optionsOpen} transparent animationType="fade" onRequestClose={() => setOptionsOpen(false)}>
      <View style={styles.settingsOverlay}><SafeAreaView style={styles.settingsSafe}><ScrollView contentContainerStyle={styles.settingsScroll}><View style={styles.settingsCard}>
        <View style={styles.sideHeader}><Text style={styles.settingsTitle}>Conversation options</Text><IconButton icon="close" label="Close conversation options" onPress={() => setOptionsOpen(false)} /></View>
        <Text style={styles.settingsText}>These preferences are remembered for this chat. Your latest written instructions take priority.</Text>
        <Text style={styles.fieldLabel}>Read images</Text>
        {([['auto', 'Auto — answer my request'], ['text', 'Just text — transcribe only'], ['full', 'Description + text']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: preferences.imageReading === value }} onPress={() => updatePreferences({ imageReading: value })} style={styles.attachButton}><Text style={styles.toolText}>{preferences.imageReading === value ? '● ' : '○ '}{label}</Text></Pressable>)}
        <Text style={styles.storageNote}>Transcription preserves readable structure and marks unclear or cropped text. Just text skips answering questions in the image.</Text>
        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Reply format</Text>
        {(['plain', 'markdown'] as const).map(format => <Pressable key={format} accessibilityRole="radio" accessibilityLabel={format === 'plain' ? 'Plain text' : 'Markdown'} accessibilityState={{ checked: preferences.format === format }} onPress={() => updatePreferences({ format })} style={styles.attachButton}><Text style={styles.toolText}>{preferences.format === format ? '● ' : '○ '}{format === 'plain' ? 'Plain text' : 'Markdown'}</Text></Pressable>)}
        {([['answersOnly', 'Answers only'], ['explanation', 'Optional explanation'], ['related', 'Related suggestions'], ['findSource', 'Find full screenshot source']] as const).map(([key, label]) => <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 }}><Text style={[styles.settingsText, { flex: 1, marginBottom: 0 }]}>{label}</Text><Switch accessibilityLabel={label} value={preferences[key]} onValueChange={value => updatePreferences({ [key]: value })} /></View>)}
        <Text style={styles.storageNote}>Answers only hides optional extras. Source lookup uses public web results when available; unseen text is never treated as visible evidence.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy conversation" onPress={() => { if (current) void copyText(conversationText(current)); setOptionsOpen(false); }} style={[styles.attachButton, { marginTop: 20 }]}><Text style={styles.toolText}>Copy conversation</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Share conversation" onPress={() => { setOptionsOpen(false); void shareConversation(); }} style={styles.attachButton}><Text style={styles.toolText}>Share conversation</Text></Pressable>
        <Text style={styles.storageNote}>Sharing exports chat text, attachment names and image prompts. Image files are not included.</Text>
      </View></ScrollView></SafeAreaView></View>
    </Modal>
    <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => !checking && setSettingsOpen(false)}>
      <KeyboardAvoidingView style={styles.settingsOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={styles.settingsSafe}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.settingsScroll}><View style={styles.settingsCard}>
          <View style={styles.sideHeader}><Text style={styles.settingsTitle}>Connection</Text><IconButton icon="close" label="Close settings" disabled={checking} onPress={() => setSettingsOpen(false)} /></View>
          <Text style={styles.settingsText}>Your app connects to JAY AI securely. Change this only if your server address changes.</Text>
          <Text style={styles.fieldLabel}>Server address</Text><TextInput accessibilityLabel="Server address" value={serverDraft} onChangeText={setServerDraft} editable={!checking} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.serverInput} />
          <Pressable accessibilityRole="button" disabled={checking} onPress={() => void saveServer()} style={[styles.connect, checking && styles.dim]}>{checking ? <ActivityIndicator color="white" /> : <Text style={styles.connectText}>Test connection & save</Text>}</Pressable>
          {!!serverNotice && <Text accessibilityLiveRegion="polite" style={styles.settingsText}>{serverNotice}</Text>}
          <Text style={styles.storageNote}>Your messages and selected files are sent to your server to generate replies.</Text>
        </View></ScrollView></SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><AppContent /></SafeAreaProvider>; }
