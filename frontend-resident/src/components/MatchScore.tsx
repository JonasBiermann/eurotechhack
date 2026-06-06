import { useI18n } from '../i18n/LanguageProvider';
import type { Factor } from '../api/client';

export function ringClass(score: number) {
  return score >= 70 ? 'ring-hi' : score >= 55 ? 'ring-mid' : 'ring-lo';
}

export function ScoreDial({ score }: { score: number }) {
  return (
    <div className="score">
      <div className={`dial ${ringClass(score)}`} style={{ ['--pct' as any]: score }}>
        <span>{Math.round(score)}<small>/100</small></span>
      </div>
    </div>
  );
}

export function FactorBars({ factors }: { factors: Factor[] }) {
  const { lang } = useI18n();
  return (
    <div className="factors">
      {factors.map((f) => (
        <div className="fbar" key={f.key}>
          <div className="flabel">
            <span>{lang === 'en' ? f.label_en : f.label_tc}</span>
            <span>{Math.round(f.value * 100)}%</span>
          </div>
          <div className="ftrack"><div className="ffill" style={{ width: `${f.value * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
