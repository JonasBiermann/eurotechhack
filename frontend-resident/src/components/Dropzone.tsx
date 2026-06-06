import { useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';

/** Immediate-upload dropzone: drag/drop or pick files, hands them to onFiles. */
export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useI18n();
  const [drag, setDrag] = useState(false);
  const add = (l: FileList | null) => { if (l && l.length) onFiles(Array.from(l)); };
  return (
    <label className={`dropzone ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
      <div>{t('docs.drop')}</div>
      <input type="file" multiple style={{ display: 'none' }} onChange={(e) => add(e.target.files)} />
    </label>
  );
}
