import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { splitReply } from './preferences';
import { markdownStyles, styles } from './styles';

export function ReplyBody({ content, format, onError }: { content: string; format: 'plain' | 'markdown'; onError: (message: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { answer, explanation } = splitReply(content);
  const render = (text: string) => format === 'plain' ? <Text selectable style={styles.userText}>{text}</Text> : <Markdown style={markdownStyles} onLinkPress={url => {
    if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => onError('Could not open this link.'));
    return false;
  }} rules={{ image: () => null }}>{text}</Markdown>;
  return <View style={{ minWidth: 0, maxWidth: '100%' }}>
    {render(answer)}
    {!!explanation && <><Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Hide explanation' : 'Show explanation'} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.attachButton}><Text style={styles.toolText}>{expanded ? 'Hide explanation' : 'Show explanation'}</Text></Pressable>{expanded && render(explanation)}</>}
  </View>;
}
