import { useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../api/client';
import { GovShell } from '../components/GovShell';

const HKID_RE = /^[A-Z]{1,2}[0-9]{6}(\([0-9A]\))?$/;

export function AuthScreen() {
  const { t } = useI18n();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [hkid, setHkid] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  const submit = async () => {
    setErr(null);
    const normalized = hkid.trim().toUpperCase().replace(/\s/g, '');
    if (!HKID_RE.test(normalized)) { setErr(t('auth.err.invalid')); return; }
    if (isRegister && !name.trim()) { setErr(t('auth.err.name')); return; }
    if (isRegister && !consent) { setErr(t('auth.err.ehealth')); return; }
    setBusy(true);
    try {
      if (isRegister) await register(normalized, name.trim(), consent);
      else await login(normalized);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 404) setErr(t('auth.err.notfound'));
      else if (status === 409) setErr(t('auth.err.exists'));
      else if (status === 400) setErr(t(isRegister && !name.trim() ? 'auth.err.name' : 'auth.err.invalid'));
      else setErr(t('auth.err.generic'));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => { setMode(isRegister ? 'login' : 'register'); setErr(null); setConsent(false); };

  return (
    <GovShell crumbs={[t('nav.home'), t('nav.residents'), t('nav.login')]}>
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="eyebrow">{t('nav.service')}</div>
          <h1 className="q-title">{t(isRegister ? 'auth.register.title' : 'auth.login.title')}</h1>
          <p className="q-sub">{t(isRegister ? 'auth.register.sub' : 'auth.login.sub')}</p>

          <section className="section" style={{ marginTop: 20 }}>
            <h3>{t('auth.hkid')}</h3>
            <input
              type="text" value={hkid} autoFocus
              onChange={(e) => setHkid(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={t('auth.hkid.ph')}
            />
            {isRegister && (
              <>
                <h3 style={{ marginTop: 16 }}>{t('auth.name')}</h3>
                <input
                  type="text" value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder={t('auth.name.ph')}
                />

                <button type="button" className={`toggle consent ${consent ? 'on' : ''}`}
                  style={{ marginTop: 16, alignItems: 'flex-start' }}
                  onClick={() => setConsent((c) => !c)}>
                  <span className={`tg-box ${consent ? 'on' : ''}`}>{consent ? '✓' : ''}</span>
                  <span className="tg-label">
                    <b style={{ display: 'block', fontSize: 14 }}>{t('auth.ehealth.label')}</b>
                    <span className="muted" style={{ display: 'block', marginTop: 3, fontSize: 12.5, lineHeight: 1.45 }}>
                      {t('auth.ehealth.desc')}
                    </span>
                  </span>
                </button>
              </>
            )}
            {err && <div className="auth-err">{err}</div>}
          </section>

          <div className="actions">
            <button className="btn btn-primary btn-lg grow"
              disabled={busy || (isRegister && !consent)} onClick={submit}>
              {t(isRegister ? 'auth.cta.register' : 'auth.cta.login')}
            </button>
          </div>
          <button className="linkbtn" onClick={switchMode}>
            {t(isRegister ? 'auth.toggle.toLogin' : 'auth.toggle.toRegister')}
          </button>
        </div>
      </div>
    </GovShell>
  );
}
