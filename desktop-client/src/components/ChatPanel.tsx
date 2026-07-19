import { useRef, useState } from 'react';
import type { ChatMessage } from '../lib/peerManager';
import { resizeImageToDataUrl } from '../lib/imageUtils';

interface Props {
  messages: ChatMessage[];
  selfNickname: string;
  onSend: (text: string, imageDataUrl?: string) => void;
}

export function ChatPanel({ messages, selfNickname, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text && !pendingImage) return;
    onSend(text, pendingImage ?? undefined);
    setDraft('');
    setPendingImage(null);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setAttaching(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setPendingImage(dataUrl);
    } catch (err) {
      console.warn('Failed to process image', err);
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="panel chat-panel">
      <h3>Chat</h3>
      <div className="chat-messages">
        {messages.length === 0 && <div className="hint-text">No messages yet — say hi.</div>}
        {messages.map((m) => (
          <div className="chat-message" key={m.id}>
            <span className="nickname">{m.nickname === selfNickname ? 'You' : m.nickname}</span>
            <time dateTime={new Date(m.ts).toISOString()}>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            {m.text && <span>{m.text}</span>}
            {m.imageDataUrl && (
              <div className="chat-image-wrap">
                <img src={m.imageDataUrl} alt="shared" className="chat-image" />
              </div>
            )}
          </div>
        ))}
      </div>

      {pendingImage && (
        <div className="pending-image-row">
          <img src={pendingImage} alt="attached" className="pending-image-thumb" />
          <button type="button" className="remove-pending-image" onClick={() => setPendingImage(null)}>
            ✕
          </button>
        </div>
      )}

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image"
          disabled={attaching}
        >
          {attaching ? '…' : '📎'}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message…"
          maxLength={500}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
