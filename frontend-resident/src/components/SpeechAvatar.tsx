import { useState } from 'react';

interface Props {
  text: string;
  speaking: boolean;
  onReplay: () => void;
  onMuteChange: (muted: boolean) => void;
}

export function SpeechAvatar({ text, speaking, onReplay, onMuteChange }: Props) {
  const [muted, setMuted] = useState(false);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    onMuteChange(next);
  };

  return (
    <div className="speech-avatar">
      {text && (
        <div className="speech-bubble">
          <p>{text}</p>
        </div>
      )}
      <div className="avatar-row">
        <button className="avatar-mute-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="avatar-circle" onClick={onReplay} title="Replay">
          {speaking && <span className="avatar-ring" />}
          {speaking && <span className="avatar-ring avatar-ring-2" />}
          <svg className="avatar-icon" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="14" r="7" fill="white" fillOpacity="0.92" />
            <path d="M6 34c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" fillOpacity="0.92" />
            {speaking && (
              <>
                <path d="M28 20 Q32 24 28 28" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.7" />
                <path d="M30 17 Q36 22 30 30" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.45" />
              </>
            )}
          </svg>
        </button>
      </div>
    </div>
  );
}
