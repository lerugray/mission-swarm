// Three variations of the stream view, exploring layout tension for disagreements.
// VAR A — "Ledger": left persona list + right round-by-round reaction feed (brief default)
// VAR B — "Opposition": two-column stream split by stance (agree | oppose), drift bridges between
// VAR C — "Matrix": persona rows × round columns grid; intersection cells ARE the reactions

const { useState: useStateS, useMemo: useMemoS, useRef: useRefS, useEffect: useEffectS } = React;

// Shared: top action bar for stream views
function StreamToolbar({ sim, variant, setVariant }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-5)',
      padding: '6px var(--sp-5)', background: 'var(--bg-1)',
      borderBottom: '1px solid var(--line)', flexShrink: 0, height: 36,
    }}>
      <div className="hflex gap-3">
        <span className="live-dot" style={{ opacity: sim.playing ? 1 : 0.2 }} />
        <span className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)' }}>
          ROUND
        </span>
        <span className="mono accent" style={{ fontSize: 'var(--fs-l)', fontWeight: 600 }}>
          {String(sim.currentRound).padStart(2, '0')}/{String(sim.maxRound).padStart(2, '0')}
        </span>
      </div>

      <div className="hflex gap-2">
        <button className="btn sm" onClick={sim.reset} title="Reset (R)">⟲ RESET</button>
        <button className="btn sm" onClick={() => sim.setPlaying(p => !p)} title="Play/Pause (Space)">
          {sim.playing ? '❚❚ PAUSE' : '▶ PLAY'}
        </button>
        <button className="btn sm" onClick={sim.step} title="Step one round (→)">→ STEP</button>
        <button className="btn sm ghost" onClick={sim.seekToEnd} title="Seek to end (End)">» END</button>
      </div>

      <div className="hflex gap-2">
        <span className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-3)' }}>PACE</span>
        <div className="seg">
          {[2, 4, 8].map(p => (
            <div key={p} className={`seg-item ${sim.pacing === p ? 'active' : ''}`} onClick={() => sim.setPacing(p)}>
              {p}s
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginLeft: 'auto' }} className="hflex gap-3">
        <span className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-3)' }}>LAYOUT</span>
        <div className="seg">
          <div className={`seg-item ${variant === 'A' ? 'active' : ''}`} onClick={() => setVariant('A')} title="Ledger layout">A · LEDGER</div>
          <div className={`seg-item ${variant === 'B' ? 'active' : ''}`} onClick={() => setVariant('B')} title="Opposition layout">B · OPPOSITION</div>
          <div className={`seg-item ${variant === 'C' ? 'active' : ''}`} onClick={() => setVariant('C')} title="Matrix layout">C · MATRIX</div>
        </div>
      </div>
    </div>
  );
}

// ============== SHARED: persona lookup ==============
function usePersonaIndex(personas) {
  return useMemoS(() => {
    const m = {};
    personas.forEach(p => m[p.id] = p);
    return m;
  }, [personas]);
}

// Round header — blocky, all-caps, terminal-feel
function RoundHeader({ round, event, count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-4)',
      padding: '6px var(--sp-5)', background: 'var(--bg-2)',
      borderTop: '1px solid var(--amber-line)', borderBottom: '1px solid var(--line)',
      fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      position: 'sticky', top: 0, zIndex: 2,
    }}>
      <span style={{ color: 'var(--amber)', fontWeight: 600 }}>ROUND {String(round).padStart(2, '0')}</span>
      <span style={{ color: 'var(--fg-3)' }}>│</span>
      <span style={{ color: 'var(--fg-2)' }}>{event?.time}</span>
      <span style={{ color: 'var(--fg-3)' }}>│</span>
      <span style={{ color: 'var(--fg-1)', textTransform: 'none', letterSpacing: 0, fontSize: 'var(--fs-s)' }}>
        {event?.label}
      </span>
      <span style={{ marginLeft: 'auto', color: 'var(--fg-3)' }}>{count} RXN</span>
    </div>
  );
}

// ============================================================
// VARIANT A — "Ledger"
// Left: persona rollup. Right: feed of round-blocks of reactions.
// ============================================================
function StreamVariantA({ sim, scenario, personas, events, personaIdx, onPersonaClick, density }) {
  const scrollRef = useRefS(null);
  const reactionsByRound = useMemoS(() => {
    const m = {};
    sim.visibleReactions.forEach(r => { (m[r.round] ||= []).push(r); });
    return m;
  }, [sim.visibleReactions]);

  // auto-scroll to bottom on new rxn
  useEffectS(() => {
    if (scrollRef.current && sim.playing) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sim.cursor, sim.playing]);

  const currentStance = (pid) => {
    const h = sim.stanceHistory[pid];
    return h ? h[h.length - 1] : personaIdx[pid].initial;
  };
  const lastDelta = (pid) => {
    const rxns = sim.visibleReactions.filter(r => r.pid === pid);
    return rxns.length ? rxns[rxns.length - 1].delta : 0;
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(280px, 320px) 1fr',
      gap: 1, background: 'var(--line)', flex: 1, minHeight: 0,
    }}>
      {/* LEFT — persona rollup */}
      <Panel
        title="PERSONAS"
        count={personas.length}
        right={<span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>SORT: ACTIVITY ↓</span>}
      >
        <div>
          {personas.map(p => {
            const stance = currentStance(p.id);
            const delta = lastDelta(p.id);
            const rxnCount = sim.visibleReactions.filter(r => r.pid === p.id).length;
            const isActive = sim.visibleReactions.slice(-3).some(r => r.pid === p.id);
            return (
              <div key={p.id}
                onClick={() => onPersonaClick(p.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr auto',
                  gap: 'var(--sp-4)', alignItems: 'center',
                  padding: '6px var(--sp-5)',
                  borderBottom: '1px solid var(--line-soft)',
                  cursor: 'pointer',
                  background: isActive ? 'var(--amber-bg)' : 'transparent',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave={e => e.currentTarget.style.background = isActive ? 'var(--amber-bg)' : 'transparent'}
              >
                <span className="mono" style={{ color: 'var(--fg-2)', fontSize: 'var(--fs-xs)' }}>{p.id}</span>
                <div className="vflex" style={{ minWidth: 0 }}>
                  <span className="mono ellipsis" style={{ color: 'var(--fg-0)', fontSize: 'var(--fs-s)' }}>
                    {p.handle}
                  </span>
                  <span className="ellipsis" style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                    {p.role}
                  </span>
                </div>
                <div className="vflex gap-1" style={{ alignItems: 'flex-end' }}>
                  <StanceBar value={stance} width={60} />
                  <div className="hflex gap-2">
                    <span className="mono" style={{
                      fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase',
                    }}>{rxnCount}×</span>
                    <span className="mono" style={{
                      fontSize: 9,
                      color: delta > 0 ? 'var(--sig-agree)' : delta < 0 ? 'var(--sig-oppose)' : 'var(--fg-3)',
                    }}>{deltaSign(delta)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* RIGHT — reaction feed */}
      <Panel
        title="REACTION STREAM"
        right={
          <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>
            {sim.playing ? <><span className="blink" style={{ color: 'var(--amber)' }}>▊</span> LIVE</> : 'PAUSED'}
          </span>
        }
      >
        <div ref={scrollRef}>
          {Object.keys(reactionsByRound).length === 0 && (
            <div style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--fg-3)' }}>
              <div className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', marginBottom: 8 }}>NO REACTIONS YET</div>
              <div className="mono" style={{ fontSize: 'var(--fs-s)' }}>▶ PLAY or → STEP to advance simulation</div>
            </div>
          )}
          {Object.keys(reactionsByRound).map(round => (
            <div key={round}>
              <RoundHeader
                round={+round}
                event={events.find(e => e.round === +round)}
                count={reactionsByRound[round].length}
              />
              <div>
                {reactionsByRound[round].map((rxn, i) => {
                  const p = personaIdx[rxn.pid];
                  const isNew = sim.visibleReactions.indexOf(rxn) >= sim.visibleReactions.length - 3;
                  return (
                    <div key={`${rxn.pid}-${rxn.round}-${i}`}
                      className={isNew ? 'row-in' : ''}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px 1fr auto',
                        gap: 'var(--sp-5)',
                        padding: '8px var(--sp-5)',
                        borderBottom: '1px solid var(--line-soft)',
                        cursor: 'pointer',
                      }}
                      onClick={() => onPersonaClick(rxn.pid)}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div className="vflex gap-1">
                        <span className="mono" style={{ color: 'var(--amber)', fontSize: 'var(--fs-s)' }}>{p.id}</span>
                        <span className="mono ellipsis" style={{ color: 'var(--fg-1)', fontSize: 'var(--fs-xs)' }}>
                          {p.handle}
                        </span>
                        <span className="ellipsis" style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                          {p.cohort}
                        </span>
                      </div>
                      <div className="vflex gap-2">
                        <div style={{
                          color: 'var(--fg-0)', fontSize: 'var(--fs-l)', lineHeight: 1.45,
                          textWrap: 'pretty',
                        }}>
                          {rxn.text}
                        </div>
                        <div className="hflex gap-2" style={{ flexWrap: 'wrap' }}>
                          {rxn.tags?.map(t => (
                            <Chip key={t} kind="neutral">#{t}</Chip>
                          ))}
                          {rxn.cites?.map((c, j) => (
                            <span key={j} className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-3)' }}>
                              ↪ "{c}"
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="vflex gap-2" style={{ alignItems: 'flex-end' }}>
                        <DeltaChip delta={rxn.delta} />
                        <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)' }}>
                          STANCE {sim.stanceHistory[rxn.pid]?.[rxn.round] ?? '—'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ============================================================
// VARIANT B — "Opposition"
// Left column: personas currently AGREEING (stance > 0).
// Right column: personas currently OPPOSING (stance < 0).
// Center spine: round markers + drift-lines crossing the spine on stance flips.
// ============================================================
function StreamVariantB({ sim, scenario, personas, events, personaIdx, onPersonaClick }) {
  // For the current round, place each reaction in agree/oppose column based on stance AFTER this reaction.
  const grouped = useMemoS(() => {
    const byRound = {};
    sim.visibleReactions.forEach(rxn => {
      const stance = sim.stanceHistory[rxn.pid]?.[rxn.round] ?? personaIdx[rxn.pid].initial;
      const side = stance >= 0 ? 'pos' : 'neg';
      (byRound[rxn.round] ||= { pos: [], neg: [], event: events.find(e => e.round === rxn.round) });
      byRound[rxn.round][side].push({ ...rxn, stance });
    });
    return byRound;
  }, [sim.visibleReactions, sim.stanceHistory, events, personaIdx]);

  const scrollRef = useRefS(null);
  useEffectS(() => {
    if (scrollRef.current && sim.playing) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sim.cursor, sim.playing]);

  // Current tally row at top
  const tally = useMemoS(() => {
    let pos = 0, neu = 0, neg = 0;
    personas.forEach(p => {
      const s = sim.stanceHistory[p.id]?.[sim.currentRound] ?? p.initial;
      if (s > 8) pos++;
      else if (s < -8) neg++;
      else neu++;
    });
    return { pos, neu, neg };
  }, [personas, sim.stanceHistory, sim.currentRound]);

  const SideCard = ({ rxn, side }) => {
    const p = personaIdx[rxn.pid];
    return (
      <div
        onClick={() => onPersonaClick(rxn.pid)}
        style={{
          background: side === 'pos' ? 'var(--sig-agree-bg)' : 'var(--sig-oppose-bg)',
          border: `1px solid ${side === 'pos' ? 'rgba(125,207,138,0.25)' : 'rgba(232,106,90,0.25)'}`,
          padding: '6px 8px',
          marginBottom: 4,
          cursor: 'pointer',
        }}
      >
        <div className="hflex gap-2" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
          <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-1)' }}>
            <span style={{ color: 'var(--amber)' }}>{p.id}</span> {p.handle}
          </span>
          <DeltaChip delta={rxn.delta} />
        </div>
        <div style={{ color: 'var(--fg-0)', fontSize: 'var(--fs-s)', lineHeight: 1.4, textWrap: 'pretty' }}>
          {rxn.text}
        </div>
        <div className="hflex gap-2" style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {rxn.tags?.slice(0, 3).map(t => (
            <span key={t} className="mono" style={{ fontSize: 9, color: 'var(--fg-3)' }}>#{t}</span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="vflex" style={{ flex: 1, minHeight: 0 }}>
      {/* Tally strip */}
      <div className="hflex" style={{
        background: 'var(--bg-2)', borderBottom: '1px solid var(--line)',
        padding: '6px var(--sp-5)', gap: 'var(--sp-6)', flexShrink: 0,
      }}>
        <span className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-3)' }}>
          CURRENT TALLY
        </span>
        <div className="hflex gap-3">
          <Chip kind="agree">● {tally.pos} ENDORSING</Chip>
          <Chip kind="neutral">● {tally.neu} NEUTRAL</Chip>
          <Chip kind="oppose">● {tally.neg} OPPOSING</Chip>
        </div>
        <div style={{ flex: 1, minWidth: 80 }}>
          {/* Proportion bar */}
          <div style={{ display: 'flex', height: 6, border: '1px solid var(--line)' }}>
            <div style={{ flex: tally.pos, background: 'var(--sig-agree)' }} />
            <div style={{ flex: tally.neu, background: 'var(--fg-3)' }} />
            <div style={{ flex: tally.neg, background: 'var(--sig-oppose)' }} />
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto', background: 'var(--bg-0)',
      }}>
        {Object.keys(grouped).length === 0 && (
          <div style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--fg-3)' }}>
            <div className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', marginBottom: 8 }}>NO REACTIONS YET</div>
            <div className="mono" style={{ fontSize: 'var(--fs-s)' }}>▶ PLAY or → STEP to advance simulation</div>
          </div>
        )}
        {Object.keys(grouped).map(round => {
          const g = grouped[round];
          return (
            <div key={round} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 140px 1fr',
              gap: 0,
              borderBottom: '1px solid var(--line)',
            }}>
              {/* LEFT — endorsing */}
              <div style={{ padding: '8px 10px', borderRight: '1px solid var(--line)' }}>
                <div className="mono uppercase" style={{
                  fontSize: 'var(--fs-xs)', color: 'var(--sig-agree)', marginBottom: 6,
                  letterSpacing: '0.08em',
                }}>
                  ▲ ENDORSING · {g.pos.length}
                </div>
                {g.pos.length === 0 && <div className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>—</div>}
                {g.pos.map((rxn, i) => <SideCard key={i} rxn={rxn} side="pos" />)}
              </div>

              {/* CENTER — round spine */}
              <div style={{
                padding: '8px 6px',
                background: 'var(--bg-1)',
                borderRight: '1px solid var(--line)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                position: 'relative',
              }}>
                <div className="mono" style={{ color: 'var(--amber)', fontSize: 'var(--fs-l)', fontWeight: 600 }}>
                  R{String(round).padStart(2, '0')}
                </div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--fg-3)' }}>{g.event?.time}</div>
                <div style={{
                  fontSize: 'var(--fs-xs)', color: 'var(--fg-1)',
                  textAlign: 'center', lineHeight: 1.3, padding: '2px 4px', textWrap: 'balance',
                }}>
                  {g.event?.label}
                </div>
                {/* vertical drift line */}
                <div style={{ flex: 1, width: 1, background: 'var(--line)', marginTop: 4 }} />
              </div>

              {/* RIGHT — opposing */}
              <div style={{ padding: '8px 10px' }}>
                <div className="mono uppercase" style={{
                  fontSize: 'var(--fs-xs)', color: 'var(--sig-oppose)', marginBottom: 6,
                  letterSpacing: '0.08em', textAlign: 'right',
                }}>
                  {g.neg.length} · OPPOSING ▼
                </div>
                {g.neg.length === 0 && <div className="mono dim" style={{ fontSize: 'var(--fs-xs)', textAlign: 'right' }}>—</div>}
                {g.neg.map((rxn, i) => <SideCard key={i} rxn={rxn} side="neg" />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// VARIANT C — "Matrix"
// Rows = personas, cols = rounds. Cell = one reaction (or blank).
// Cell background color = stance at that round.
// ============================================================
function StreamVariantC({ sim, scenario, personas, events, personaIdx, onPersonaClick }) {
  const maxRound = sim.maxRound;

  // Index reactions by pid+round
  const rxnMap = useMemoS(() => {
    const m = {};
    sim.visibleReactions.forEach(r => {
      m[`${r.pid}-${r.round}`] = r;
    });
    return m;
  }, [sim.visibleReactions]);

  const [selected, setSelected] = useStateS(null);

  const Cell = ({ p, round }) => {
    const key = `${p.id}-${round}`;
    const rxn = rxnMap[key];
    const stance = sim.stanceHistory[p.id]?.[round] ?? p.initial;
    const prevStance = sim.stanceHistory[p.id]?.[round - 1] ?? p.initial;
    const drifted = rxn ? Math.abs(rxn.delta) > 6 : false;
    const pastCurrent = round > sim.currentRound;

    const bgColor = pastCurrent
      ? 'var(--bg-0)'
      : stance > 0
        ? `color-mix(in oklab, var(--sig-agree) ${Math.min(25, Math.abs(stance) / 4)}%, var(--bg-1))`
        : stance < 0
          ? `color-mix(in oklab, var(--sig-oppose) ${Math.min(25, Math.abs(stance) / 4)}%, var(--bg-1))`
          : 'var(--bg-1)';

    return (
      <div
        onClick={() => rxn && setSelected({ pid: p.id, round })}
        style={{
          background: bgColor,
          border: '1px solid var(--line)',
          borderLeft: 'none', borderTop: 'none',
          padding: '4px 6px',
          cursor: rxn ? 'pointer' : 'default',
          overflow: 'hidden',
          position: 'relative',
          minWidth: 0,
          opacity: pastCurrent ? 0.4 : 1,
        }}
      >
        {rxn && (
          <>
            <div className="hflex gap-2" style={{ marginBottom: 2 }}>
              <span className="mono" style={{
                fontSize: 9, fontWeight: 600,
                color: rxn.delta > 0 ? 'var(--sig-agree)' : rxn.delta < 0 ? 'var(--sig-oppose)' : 'var(--fg-3)',
              }}>
                {deltaSign(rxn.delta)}
              </span>
              {drifted && <span className="mono" style={{ fontSize: 9, color: 'var(--sig-drift)' }}>◆ DRIFT</span>}
              <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)', marginLeft: 'auto' }}>
                {stance > 0 ? '+' : ''}{stance}
              </span>
            </div>
            <div style={{
              fontSize: 10, lineHeight: 1.35, color: 'var(--fg-1)',
              display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', textWrap: 'pretty',
            }}>
              {rxn.text}
            </div>
          </>
        )}
        {!rxn && !pastCurrent && (
          <div style={{ color: 'var(--fg-4)', fontSize: 10, fontFamily: 'var(--mono)' }}>·</div>
        )}
      </div>
    );
  };

  const selectedRxn = selected ? rxnMap[`${selected.pid}-${selected.round}`] : null;
  const selectedPersona = selected ? personaIdx[selected.pid] : null;

  return (
    <div className="vflex" style={{ flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `220px repeat(${maxRound}, minmax(160px, 1fr))`,
          position: 'relative',
        }}>
          {/* Header row */}
          <div style={{
            background: 'var(--bg-2)', borderBottom: '1px solid var(--amber-line)',
            padding: '6px 10px', position: 'sticky', top: 0, left: 0, zIndex: 3,
          }}>
            <span className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)' }}>
              PERSONA · ROUND →
            </span>
          </div>
          {Array.from({ length: maxRound }).map((_, i) => {
            const r = i + 1;
            const ev = events.find(e => e.round === r);
            const past = r > sim.currentRound;
            return (
              <div key={r} style={{
                background: r === sim.currentRound ? 'var(--amber-bg)' : 'var(--bg-2)',
                borderBottom: '1px solid var(--amber-line)',
                borderLeft: '1px solid var(--line)',
                padding: '6px 8px',
                position: 'sticky', top: 0, zIndex: 2,
                opacity: past ? 0.4 : 1,
              }}>
                <div className="hflex gap-2" style={{ marginBottom: 2 }}>
                  <span className="mono" style={{
                    fontSize: 'var(--fs-s)', fontWeight: 600,
                    color: r === sim.currentRound ? 'var(--amber)' : 'var(--fg-0)',
                  }}>
                    R{String(r).padStart(2, '0')}
                  </span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)' }}>{ev?.time}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-2)', lineHeight: 1.25, textWrap: 'balance' }}>
                  {ev?.label}
                </div>
              </div>
            );
          })}

          {/* Persona rows */}
          {personas.map(p => {
            const history = sim.stanceHistory[p.id] || [p.initial];
            return (
              <React.Fragment key={p.id}>
                <div
                  onClick={() => onPersonaClick(p.id)}
                  style={{
                    background: 'var(--bg-1)',
                    borderBottom: '1px solid var(--line)',
                    borderRight: '1px solid var(--amber-line)',
                    padding: '6px 10px',
                    position: 'sticky', left: 0, zIndex: 1, cursor: 'pointer',
                  }}
                >
                  <div className="hflex gap-3">
                    <div className="vflex" style={{ minWidth: 0, flex: 1 }}>
                      <span className="mono" style={{ color: 'var(--amber)', fontSize: 'var(--fs-s)' }}>
                        {p.id} · {p.handle}
                      </span>
                      <span className="ellipsis" style={{ color: 'var(--fg-3)', fontSize: 10 }}>
                        {p.role}
                      </span>
                    </div>
                    <Sparkline values={history.slice(0, sim.currentRound + 1)} width={50} height={18} />
                  </div>
                </div>
                {Array.from({ length: maxRound }).map((_, i) => (
                  <Cell key={`${p.id}-${i}`} p={p} round={i + 1} />
                ))}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Detail drawer */}
      {selectedRxn && (
        <div style={{
          flexShrink: 0, borderTop: '2px solid var(--amber-line)',
          background: 'var(--bg-1)', padding: 'var(--sp-5)',
          maxHeight: 180, overflow: 'auto',
        }}>
          <div className="hflex gap-4" style={{ marginBottom: 6 }}>
            <span className="mono" style={{ color: 'var(--amber)', fontSize: 'var(--fs-m)', fontWeight: 600 }}>
              {selectedPersona.id} · {selectedPersona.handle}
            </span>
            <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>{selectedPersona.role}</span>
            <Chip kind="amber">R{String(selected.round).padStart(2, '0')}</Chip>
            <DeltaChip delta={selectedRxn.delta} />
            <span style={{ marginLeft: 'auto' }}>
              <button className="iconbtn" onClick={() => setSelected(null)}>✕</button>
            </span>
          </div>
          <div style={{ color: 'var(--fg-0)', fontSize: 'var(--fs-l)', lineHeight: 1.5, textWrap: 'pretty' }}>
            {selectedRxn.text}
          </div>
          <div className="hflex gap-2" style={{ marginTop: 6 }}>
            {selectedRxn.tags?.map(t => <Chip key={t} kind="neutral">#{t}</Chip>)}
            {selectedRxn.cites?.map((c, i) => (
              <span key={i} className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-3)' }}>
                ↪ "{c}"
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  StreamToolbar, StreamVariantA, StreamVariantB, StreamVariantC, RoundHeader, usePersonaIndex,
});
