import { useCallback, useRef, useState } from 'react';

const KEY = import.meta.env.VITE_ELEVENLABS_KEY as string;
const VOICE_DEFAULT = (import.meta.env.VITE_ELEVENLABS_VOICE as string) || 'yj30vwTGJxSHezdAGsv9';

export function useElevenLabs(voiceId?: string) {
  const voice = voiceId || VOICE_DEFAULT;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;   // always reflects latest voiceId prop
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [currentText, setCurrentText] = useState('');

  const stop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!KEY || !text.trim() || mutedRef.current) return;
    stop();
    setCurrentText(text);
    setSpeaking(true);
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceRef.current}`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.85 },
        }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; };
      audio.onerror = () => { setSpeaking(false); audioRef.current = null; };
      await audio.play();
    } catch (err) {
      console.error('TTS error', err);
      setSpeaking(false);
    }
  }, [stop]);

  const setMuted = useCallback((v: boolean) => {
    mutedRef.current = v;
    if (v) stop();
  }, [stop]);

  return { speak, stop, speaking, currentText, setMuted };
}
