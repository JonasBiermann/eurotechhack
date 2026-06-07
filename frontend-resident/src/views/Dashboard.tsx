import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/LanguageProvider';
import { api, type Application } from '../api/client';
import { GovShell } from '../components/GovShell';
import { ScoreDial, FactorBars, ringClass } from '../components/MatchScore';
import { MatchDetails } from '../components/MatchDetails';
import { NextSteps } from '../components/NextSteps';
import { CohortCard } from '../components/CohortCard';
import { PermitsPage } from './PermitsPage';

/* simple inline line-icons (no emoji) */
const Icon = {
  apply: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 18v-6M9 15h6"/></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/></svg>,
  guide: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h7M8 11h7"/></svg>,
  elderly: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="6" r="3"/><path d="M9 21v-5l-2-2 1-5h6l1 5-2 2v5"/></svg>,
  permit: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M13 10h5M13 14h5M5 16h6"/></svg>,
};

/* Required documents — checklist completion is derived from the uploaded docs in order. */
const REQUIRED_DOCS = ['doc.apartment', 'doc.healthcare', 'doc.job'] as const;

type Page = 'home' | 'guide' | 'elderly' | 'permits';

export function Dashboard({ onNew, initialAppId, onConsumedInitial }: {
  onNew: () => void; initialAppId?: number | null; onConsumedInitial?: () => void;
}) {
  const { t, L, lang } = useI18n();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [declared, setDeclared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = () => api.myApplications().then(setApps).catch(() => setApps([]));
  useEffect(() => { load(); }, []);

  // After "Start", App passes the new application's id so we open its overview directly.
  useEffect(() => {
    if (initialAppId != null) { setSelectedId(initialAppId); setPage('home'); onConsumedInitial?.(); }
  }, [initialAppId, onConsumedInitial]);

  // Reset the truth declaration when switching between applications.
  useEffect(() => { setDeclared(false); }, [selectedId]);

  const upload = async (id: number, files: File[]) => {
    for (const f of files) { try { await api.uploadDocument(id, f); } catch { /* ignore */ } }
    load();
  };
  const uploadProof = async (id: number, files: File[]) => {
    for (const f of files) { try { await api.uploadDocument(id, f, 'proof_of_move'); } catch { /* ignore */ } }
    load();
  };
  const submitApp = async (id: number) => {
    setSubmitting(true);
    try { await api.submitApplication(id); await load(); } catch { /* ignore */ }
    finally { setSubmitting(false); }
  };

  const deleteApp = async (id: number) => {
    setDeleting(true);
    try { await api.deleteApplication(id); setSelectedId(null); setConfirmDeleteId(null); await load(); }
    catch (e) { console.error('delete failed', e); }
    finally { setDeleting(false); }
  };

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-HK'); }
    catch { return iso?.slice(0, 10) ?? ''; }
  };
  const scrollToList = () => listRef.current?.scrollIntoView({ behavior: 'smooth' });

  const selected = apps?.find((a) => a.id === selectedId) ?? null;

  // ---------- permits & allowances ----------
  if (page === 'permits') {
    return <PermitsPage onBack={() => setPage('home')} />;
  }

  // ---------- content pages: Guidebook / Elderly services ----------
  if (page === 'guide' || page === 'elderly') {
    const isGuide = page === 'guide';
    const steps = isGuide
      ? ['guide.s1', 'guide.s2', 'guide.s3', 'guide.s4', 'guide.s5']
      : ['elderly.s1', 'elderly.s2', 'elderly.s3', 'elderly.s4'];
    return (
      <GovShell crumbs={[t('nav.home'), t('nav.residents'),
        { label: t('nav.service'), onClick: () => setPage('home') },
        t(isGuide ? 'tile.guide' : 'tile.elderly')]}>
        <div className="gov-content">
          <button className="btn" onClick={() => setPage('home')}>← {t('page.back')}</button>
          <section className="gov-hero" style={{ marginTop: 16 }}>
            <div>
              <h1>{t(isGuide ? 'guide.title' : 'elderly.title')}</h1>
              <p>{t(isGuide ? 'guide.sub' : 'elderly.sub')}</p>
            </div>
          </section>

          <div className="page-prose">
            {steps.map((s) => (
              <section className="section" key={s}>
                <h3 className="prose-h">{t(`${s}.t`)}</h3>
                <p className="prose-p">{t(`${s}.d`)}</p>
              </section>
            ))}
          </div>

          {isGuide ? (
            <>
              <h2 className="gov-sec-title">{t('guide.faqTitle')}</h2>
              <section className="section">
                <ul className="prose-list">
                  <li>{t('guide.faq1')}</li>
                  <li>{t('guide.faq2')}</li>
                  <li>{t('guide.faq3')}</li>
                </ul>
              </section>
            </>
          ) : (
            <section className="section helpline">
              <h3 className="prose-h">{t('elderly.helpline')}</h3>
              <p className="prose-p">{t('elderly.helpline.d')}</p>
            </section>
          )}
        </div>
      </GovShell>
    );
  }

  // ---------- application overview (selected) ----------
  if (selected) {
    const a = selected;
    const top = a.top_destination ?? a.destinations[0] ?? null;
    const decided = a.status === 'approved' || a.status === 'rejected' || a.status === 'moved';
    const showNextSteps = a.status === 'approved' || a.status === 'moved';
    const isStarted = a.status === 'started';
    const docDone = (i: number) => a.documents.length > i;
    const allDocs = REQUIRED_DOCS.every((_, i) => docDone(i));
    const checklist: { label: string; desc: string; done: boolean; docIndex?: number }[] = [
      { label: t('todo.started'), desc: t('todo.started.d'), done: true },
      ...REQUIRED_DOCS.map((k, i) => ({ label: t(k), desc: t(`${k}.d`), done: docDone(i), docIndex: i })),
      { label: t('todo.declare'), desc: t('todo.declare.d'), done: !isStarted },
      { label: t('todo.review'), desc: t('todo.review.d'), done: decided },
    ];
    const doneCount = checklist.filter((c) => c.done).length;

    return (
      <GovShell crumbs={[t('nav.home'), t('nav.residents'),
        { label: t('nav.service'), onClick: () => setSelectedId(null) },
        `${t('dash.app')} #${a.id}`]}>
        <div className="gov-content">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setSelectedId(null)}>← {t('dash.backToList')}</button>
            {confirmDeleteId === a.id ? (
              <>
                <span style={{ fontSize: 13, color: '#c0392b' }}>{t('dash.deleteConfirm')}</span>
                <button className="btn btn-danger" disabled={deleting} onClick={() => deleteApp(a.id)}>
                  {deleting ? '…' : t('dash.deleteYes')}
                </button>
                <button className="btn" onClick={() => setConfirmDeleteId(null)}>{t('dash.deleteNo')}</button>
              </>
            ) : (
              <button className="btn btn-danger" onClick={() => setConfirmDeleteId(a.id)}>{t('dash.delete')}</button>
            )}
          </div>

          {/* ---- to-do checklist (top of the overview) ---- */}
          <h2 className="gov-sec-title" style={{ marginTop: 16 }}>{t('todo.title')}</h2>
          <section className="section todo">
            <div className="todo-head">
              <p className="sub" style={{ margin: 0 }}>{t('todo.sub')}</p>
              <span className="todo-count">{doneCount}/{checklist.length} {t('todo.progress')}</span>
            </div>
            <div className="todo-list">
              {checklist.map((c, i) => {
                const uploadable = isStarted && c.docIndex !== undefined && !c.done;
                const docFile = c.docIndex !== undefined && c.done ? a.documents[c.docIndex] : null;
                const inner = (
                  <>
                    <span className="todo-box">{c.done ? '✓' : ''}</span>
                    <div className="todo-text">
                      <span className="todo-label">{c.label}</span>
                      <span className="todo-desc">{docFile ? docFile.filename : c.desc}</span>
                    </div>
                    <span className={`todo-pill ${c.done ? 'ok' : ''}`}>
                      {c.done ? t('todo.done') : uploadable ? t('todo.upload') : t('todo.pending')}
                    </span>
                  </>
                );
                if (uploadable) {
                  return (
                    <label className="todo-item upload" key={i}>
                      {inner}
                      <input type="file" accept="application/pdf" style={{ display: 'none' }}
                        onChange={(e) => {
                          if (e.target.files?.length) upload(a.id, Array.from(e.target.files));
                          e.target.value = '';
                        }} />
                    </label>
                  );
                }
                return (
                  <div className={`todo-item ${c.done ? 'done' : ''}`} key={i}>{inner}</div>
                );
              })}
            </div>

            {isStarted && (
              <>
                {/* truth declaration + submit — unlocked once every document is in */}
                {allDocs ? (
                  <div className="declare-box">
                    <button type="button" className={`toggle ${declared ? 'on' : ''}`}
                      style={{ alignItems: 'flex-start' }} onClick={() => setDeclared((v) => !v)}>
                      <span className={`tg-box ${declared ? 'on' : ''}`}>{declared ? '✓' : ''}</span>
                      <span className="tg-label">{t('declare.text')}</span>
                    </button>
                    <button className="btn btn-primary btn-lg grow" style={{ marginTop: 12 }}
                      disabled={!declared || submitting} onClick={() => submitApp(a.id)}>
                      {submitting ? t('sub.submitting') : t('sub.submit')}
                    </button>
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{t('declare.locked')}</p>
                )}
              </>
            )}
          </section>

          {/* ---- same-city community ("you won't arrive alone"): right after the
                 documents overview, surfaced once the move is approved ---- */}
          {showNextSteps && <CohortCard app={a} />}

          {/* ---- next steps + proof of move (after approval) ---- */}
          {showNextSteps && (
            <NextSteps app={a} dest={top} onUploadProof={(fs) => uploadProof(a.id, fs)}
              onOpenPermits={() => setPage('permits')} />
          )}

          {/* ---- your selected city with all the advantages ---- */}
          {top && (
            <>
              <h2 className="gov-sec-title">{t('app.yourCity')}</h2>
              <div className={`dcard city-hero ${ringClass(top.match?.score ?? 0)}`} style={{ cursor: 'default' }}>
                <ScoreDial score={top.match?.score ?? 0} />
                <div className="info">
                  <h4>{L(top, 'name')} <span className="sec">{L(top, 'name') === top.name_en ? top.name_tc : top.name_en}</span></h4>
                  <div className="attrs">
                    {((top.net_savings_hkd ?? top.monthly_savings_hkd ?? 0) > 0)
                      ? <span className="save-pill">{t('res.netSave')} <b>{`HK$${Math.round(top.net_savings_hkd ?? top.monthly_savings_hkd ?? 0).toLocaleString()}`}</b>{t('common.perMonth')}</span>
                      : <span className="save-pill">{t('res.shortfall')} <b>{`HK$${Math.abs(Math.round(top.net_savings_hkd ?? top.monthly_savings_hkd ?? 0)).toLocaleString()}`}</b>{t('common.perMonth')}</span>}
                    <span>{t('d.travel')} <b>{top.travel_time_hr}{t('common.hours')}</b></span>
                  </div>
                  <div className="kv" style={{ borderBottom: 0, paddingBottom: 0 }}>
                    <span>{t('app.status')}</span>
                    <b><span className={`badge badge-${a.status}`}>{t(`status.${a.status}`)}</span></b>
                  </div>
                  {a.note && <div className="optin" style={{ textAlign: 'left' }}><b>{t('sub.officerNote')}:</b>&nbsp;{a.note}</div>}
                </div>
              </div>

              <h2 className="gov-sec-title">{t('app.advantages')}</h2>
              <section className="section">
                {top.match && <FactorBars factors={top.match.factors} />}
                <MatchDetails d={top} />
              </section>
            </>
          )}

          {/* ---- other ranked options ---- */}
          {a.destinations.length > 1 && (
            <>
              <h2 className="gov-sec-title">{t('app.otherOptions')}</h2>
              <div className="gov-applist">
                {a.destinations.filter((d) => d.id !== top?.id).map((d, i) => (
                  <div key={d.id} className={`dcard ${ringClass(d.match?.score ?? 0)}`} style={{ cursor: 'default' }}>
                    <div className="rank">{i + 2}</div>
                    <ScoreDial score={d.match?.score ?? 0} />
                    <div className="info">
                      <h4>{L(d, 'name')}</h4>
                      <div className="attrs">
                        <span>{t('d.cost')} <b>{t('common.hkd')}{d.monthly_cost.toLocaleString()}</b></span>
                        <span>{t('d.travel')} <b>{d.travel_time_hr}{t('common.hours')}</b></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </GovShell>
    );
  }

  // ---------- portal homepage ----------
  // A rejected application no longer counts as "live", so the resident may start a new one.
  const hasApp = (apps?.some((a) => a.status !== 'rejected')) ?? false;
  const tiles = [
    // one application per resident — the "start" tile disappears once you have one
    ...(hasApp ? [] : [{ ic: Icon.apply, title: t('tile.start'), desc: t('tile.start.d'), onClick: onNew }]),
    { ic: Icon.list, title: t('tile.myapps'), desc: t('tile.myapps.d'), onClick: scrollToList },
    { ic: Icon.permit, title: t('tile.permits'), desc: t('tile.permits.d'), onClick: () => setPage('permits') },
    { ic: Icon.guide, title: t('tile.guide'), desc: t('tile.guide.d'), onClick: () => setPage('guide') },
    { ic: Icon.elderly, title: t('tile.elderly'), desc: t('tile.elderly.d'), onClick: () => setPage('elderly') },
  ];

  return (
    <GovShell crumbs={[t('nav.home'), t('nav.residents'), t('nav.service')]}>
      <div className="gov-content">
        <section className="gov-hero">
          <div>
            <h1>{t('hero.title')}</h1>
            <p>{t('hero.sub')}</p>
          </div>
          {hasApp
            ? <span style={{ color: '#fff', fontSize: 14, opacity: 0.9, maxWidth: 220 }}>{t('home.oneNote')}</span>
            : <button className="btn btn-primary btn-lg" onClick={onNew}>{t('tile.start')} →</button>}
        </section>

        <h2 className="gov-sec-title">{t('home.services')}</h2>
        <div className="gov-tiles">
          {tiles.map((tile, i) => (
            <button key={i} className="gov-tile" onClick={tile.onClick}>
              <span className="ic">{tile.ic}</span>
              <h4>{tile.title}</h4>
              <p>{tile.desc}</p>
            </button>
          ))}
        </div>

        <h2 className="gov-sec-title" ref={listRef}>{t('home.yourapps')}</h2>
        <div className="gov-applist">
          {apps === null && <div className="center-msg">{t('common.loading')}</div>}

          {apps !== null && apps.length === 0 && (
            <div className="applist-empty">{t('dash.empty')}</div>
          )}

          {apps?.map((a) => {
            const dest = a.top_destination;
            return (
              <div key={a.id} className="dcard" onClick={() => setSelectedId(a.id)}>
                <div className="rank">#{a.id}</div>
                <div className="info">
                  <h4>{dest ? L(dest, 'name') : t('dash.app')}</h4>
                  <div className="attrs">
                    <span>{t('dash.submitted_on')} <b>{fmtDate(a.created_at)}</b></span>
                    <span>{t('docs.title')} <b>{a.documents.length}</b></span>
                  </div>
                </div>
                <span className={`badge badge-${a.status}`}>{t(`status.${a.status}`)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </GovShell>
  );
}
