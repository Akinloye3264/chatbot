import type { Conversation, Message } from './chat';
export type ReplyOptions = { imageReading: 'auto' | 'text' | 'full'; format: 'plain' | 'markdown'; answersOnly: boolean; explanation: boolean; related: boolean; findSource: boolean };
export const defaultOptions: ReplyOptions = { imageReading: 'auto', format: 'markdown', answersOnly: false, explanation: false, related: false, findSource: false };
export function getOptions(value?: Partial<ReplyOptions>): ReplyOptions {
  return { imageReading: value?.imageReading === 'text' || value?.imageReading === 'full' ? value.imageReading : 'auto', format: value?.format === 'plain' ? 'plain' : 'markdown', answersOnly: value?.answersOnly === true, explanation: value?.explanation === true, related: value?.related === true, findSource: value?.findSource === true };
}
export function rememberRequest(text: string, current: ReplyOptions): ReplyOptions {
  const next = { ...current };
  if (/\b(?:give me |provide |return )?(?:just|only) (?:the )?answers\b/i.test(text)) next.answersOnly = true;
  if (/\b(?:explain (?:your|the) answer|include (?:an )?explanation)\b/i.test(text)) { next.answersOnly = false; next.explanation = true; }
  if (/\b(?:use|in|switch to) plain text\b/i.test(text)) next.format = 'plain';
  if (/\b(?:use|in|switch to) markdown\b/i.test(text)) next.format = 'markdown';
  return next;
}
export function splitReply(content: string) {
  const index = content.indexOf('[[EXPLANATION]]');
  return index < 0 ? { answer: content, explanation: '' } : { answer: content.slice(0, index).trimEnd(), explanation: content.slice(index + 15).trim() };
}
export function messageText(message: Message) {
  const { answer, explanation } = splitReply(message.content);
  return [answer, explanation && `Explanation:\n${explanation}`, message.image && `Image prompt: ${message.image.prompt}`, ...(message.attachments ?? []).map(file => `Attachment: ${file.name}`)].filter(Boolean).join('\n\n');
}
export function conversationText(chat: Conversation) {
  return [chat.title, ...chat.messages.map(message => {
    const text = messageText(message);
    return text ? `${message.role === 'user' ? 'You' : 'JAY AI'}:\n${text}` : '';
  }).filter(Boolean)].join('\n\n');
}
