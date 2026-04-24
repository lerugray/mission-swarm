// Config view, Persona detail view, Report view

const { useState: useStateV, useMemo: useMemoV } = React;

// ============================================================
// CONFIG VIEW — simulation setup form
// ============================================================
function ConfigView({ scenario, personas, onStart, sim }) {
  const [docOpen, setDocOpen] = useStateV(true);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1.1fr 1fr',
      gap: 1,
      background: 'var(--line)',
      flex: 1, minHeight: 0,
    }}>
      {/* LEFT — input document */}
      <Panel
        title="INPUT DOCUMENT"
        right={
          <div className="hflex gap-2">
            <Chip kind="amber">PRESS RELEASE</Chip>
            <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>1.4 KB</span>
          </div>
        }
      >
        <div style={{ padding: 'var(--sp-6)', overflow: 'auto' }}>
          <div className="vflex gap-5">
            <div className="vflex gap-2">
              <div className="field-label">
                <span>DOCUMENT TITLE</span>
                <Kbd>D</Kbd>
              </div>
              <div className="mono" style={{
                padding: '6px 10px', background: 'var(--bg-0)',
                border: '1px solid var(--line)', color: 'var(--fg-0)',
              }}>
                {scenario.document.title}
              </div>
            </div>

            <div className="hflex gap-5">
              <div className="field grow">
                <div className="field-label">SOURCE</div>
                <div className="mono" style={{
                  padding: '6px 10px', background: 'var(--bg-0)',
                  border: '1px solid var(--line)', color: 'var(--fg-1)',
                }}>{scenario.document.source}</div>
              </div>
              <div className="field">
                <div className="field-label">DATE</div>
                <div className="mono" style={{
                  padding: '6px 10px', background: 'var(--bg-0)',
                  border: '1px solid var(--line)', color: 'var(--fg-1)',
                }}>{scenario.document.date}</div>
              </div>
            </div>

            <div className="field">
              <div className="field-label">
                <span>CONTENT PREVIEW</span>
                <span className="hint">{scenario.document.excerpt.split(/\s+/).length} words</span>
              </div>
              <pre style={{
                padding: 'var(--sp-5)', background: 'var(--bg-0)',
                border: '1px solid var(--line)', color: 'var(--fg-0)',
                fontFamily: 'var(--mono)', fontSize: 'var(--fs-s)',
                lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 280,
                overflow: 'auto', margin: 0,
              }}>{scenario.document.excerpt}</pre>
            </div>

            <div className="vflex gap-2">
              <div className="field-label">EXTRACTED ENTITIES</div>
              <div className="hflex gap-2" style={{ flexWrap: 'wrap' }}>
                {['GeneralStaff', 'Polsia', 'BYOK', 'MIT license', 'self-hosted', 'Anthropic', 'OpenAI', 'OpenRouter', 'Ollama', 'agent orchestration'].map(e => (
                  <Chip key={e} kind="neutral">{e}</Chip>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* RIGHT — simulation config + persona preview */}
      <div className="vflex" style={{ background: 'var(--bg-0)' }}>
        <Panel title="SIMULATION PARAMETERS">
          <div style={{ padding: 'var(--sp-6)' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-6) var(--sp-5)',
            }}>
              <div className="field">
                <div className="field-label"><span>SIM NAME</span><Kbd>⌘N</Kbd></div>
                <input className="input" defaultValue={scenario.name} />
              </div>
              <div className="field">
                <div className="field-label">ROUND COUNT</div>
                <input className="input" type="number" defaultValue={scenario.config.rounds} />
              </div>

              <div className="field">
                <div className="field-label">PERSONA COUNT</div>
                <input className="input" type="number" defaultValue={scenario.config.persona_count} />
              </div>
              <div className="field">
                <div className="field-label">PACING (SEC/ROUND)</div>
                <input className="input" type="number" defaultValue={scenario.config.pacing_sec} />
              </div>

              <div className="field">
                <div className="field-label">SAMPLING STRATEGY</div>
                <select className="select" defaultValue="stratified">
                  <option value="stratified">stratified (by cohort)</option>
                  <option value="uniform">uniform</option>
                  <option value="adversarial">adversarial-seeded</option>
                  <option value="manual">manual list</option>
                </select>
              </div>
              <div className="field">
                <div className="field-label">DOMAIN CONSTRAINT</div>
                <select className="select" defaultValue="b2b-tech">
                  <option value="b2b-tech">B2B tech operators</option>
                  <option value="consumer">consumer</option>
                  <option value="policy">policy / regulatory</option>
                  <option value="open">open</option>
                </select>
              </div>

              <div className="field" style={{ gridColumn: '1 / span 2' }}>
                <div className="field-label">COHORT MIX</div>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2,
                  border: '1px solid var(--line)', background: 'var(--bg-0)',
                }}>
                  {[
                    ['operator', 4, 'var(--amber)'],
                    ['enterprise', 3, 'var(--sig-provider)'],
                    ['engineer', 2, 'var(--sig-agree)'],
                    ['investor', 1, 'var(--sig-drift)'],
                    ['media', 1, 'var(--fg-1)'],
                    ['industry', 2, 'var(--fg-1)'],
                    ['skeptic', 1, 'var(--sig-oppose)'],
                  ].map(([name, count, c]) => (
                    <div key={name} style={{
                      padding: '5px 6px', borderRight: '1px solid var(--line)',
                      fontFamily: 'var(--mono)', fontSize: 10, gridColumn: `span ${count}`,
                      color: c, textTransform: 'uppercase', letterSpacing: '0.06em',
                      background: 'var(--bg-1)',
                    }}>
                      {name} ×{count}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="PROVIDER">
          <div style={{ padding: 'var(--sp-6)' }}>
            <div className="seg" style={{ marginBottom: 12 }}>
              <div className="seg-item active">OPENROUTER</div>
              <div className="seg-item">OLLAMA</div>
              <div className="seg-item">ANTHROPIC DIRECT</div>
              <div className="seg-item">DRY RUN</div>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-5)',
            }}>
              <div className="field">
                <div className="field-label">MODEL</div>
                <div className="mono" style={{
                  padding: '6px 10px', background: 'var(--bg-0)',
                  border: '1px solid var(--line)', color: 'var(--sig-provider)',
                }}>anthropic/claude-sonnet-4.5</div>
              </div>
              <div className="field">
                <div className="field-label">BUDGET (USD)</div>
                <input className="input" type="number" defaultValue={scenario.budget.budget_usd} step="0.1" />
              </div>
              <div className="field">
                <div className="field-label">TEMPERATURE</div>
                <input className="input" defaultValue="0.8" />
              </div>
              <div className="field">
                <div className="field-label">MAX TOKENS / RXN</div>
                <input className="input" defaultValue="400" />
              </div>
            </div>
            <div style={{
              marginTop: 12, padding: '6px 10px', background: 'var(--bg-0)',
              border: '1px solid var(--line)', fontFamily: 'var(--mono)',
              fontSize: 'var(--fs-xs)', color: 'var(--fg-2)',
            }}>
              <span style={{ color: 'var(--sig-agree)' }}>✓</span> API key present · <span style={{ color: 'var(--sig-agree)' }}>✓</span> model reachable · <span style={{ color: 'var(--sig-agree)' }}>✓</span> budget configured
            </div>
          </div>
        </Panel>

        <div style={{ padding: 'var(--sp-6)', borderTop: '1px solid var(--line)', background: 'var(--bg-1)' }}>
          <div className="hflex gap-4">
            <div className="vflex">
              <span className="mono dim" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase' }}>
                ESTIMATED
              </span>
              <span className="mono" style={{ fontSize: 'var(--fs-m)', color: 'var(--fg-1)' }}>
                ~{scenario.config.rounds * scenario.config.persona_count} reactions · ~$0.47 · ~{scenario.config.rounds * scenario.config.pacing_sec}s
              </span>
            </div>
            <div style={{ marginLeft: 'auto' }} className="hflex gap-3">
              <button className="btn">SAVE CONFIG <Kbd>⌘S</Kbd></button>
              <button className="btn primary" onClick={onStart}>▶ START SIMULATION <Kbd>⏎</Kbd></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PERSONA DETAIL VIEW
// ============================================================
function PersonaView({ personas, reactions, sim, scenario, events, selectedPid, setSelectedPid }) {
  const p = personas.find(x => x.id === selectedPid) || personas[0];
  const history = sim.stanceHistory[p.id] || [p.initial];
  const personRxns = reactions.filter(r => r.pid === p.id).sort((a, b) => a.round - b.round);
  const visibleRxns = sim.visibleReactions.filter(r => r.pid === p.id);

  const currentStance = history[history.length - 1];
  const initialStance = p.initial;
  const totalDrift = currentStance - initialStance;

  // Count how often each tag appears for this persona
  const tagFreq = {};
  personRxns.forEach(r => r.tags?.forEach(t => tagFreq[t] = (tagFreq[t] || 0) + 1));
  const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '240px 1fr',
      gap: 1,
      background: 'var(--line)',
      flex: 1, minHeight: 0,
    }}>
      {/* LEFT: persona list */}
      <Panel title="PERSONAS" count={personas.length}>
        <div>
          {personas.map(pp => {
            const s = sim.stanceHistory[pp.id]?.slice(-1)[0] ?? pp.initial;
            const active = pp.id === p.id;
            return (
              <div key={pp.id} onClick={() => setSelectedPid(pp.id)}
                style={{
                  padding: '6px var(--sp-5)',
                  borderBottom: '1px solid var(--line-soft)',
                  background: active ? 'var(--amber-bg)' : 'transparent',
                  borderLeft: active ? '2px solid var(--amber)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                <div className="hflex gap-3">
                  <span className="mono" style={{
                    color: active ? 'var(--amber)' : 'var(--fg-2)',
                    fontSize: 'var(--fs-xs)',
                  }}>{pp.id}</span>
                  <span className="mono ellipsis grow" style={{ fontSize: 'var(--fs-s)' }}>{pp.handle}</span>
                  <StanceBar value={s} width={40} />
                </div>
                <div className="ellipsis" style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>
                  {pp.role}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* RIGHT: persona detail */}
      <div className="vflex" style={{ background: 'var(--bg-0)', overflow: 'auto' }}>
        {/* Header */}
        <div style={{
          padding: 'var(--sp-6)', borderBottom: '1px solid var(--line)', background: 'var(--bg-1)',
        }}>
          <div className="hflex gap-4" style={{ alignItems: 'flex-start' }}>
            <div className="vflex gap-2" style={{ flex: 1 }}>
              <div className="hflex gap-3">
                <span className="mono" style={{
                  color: 'var(--amber)', fontSize: 'var(--fs-xl)', fontWeight: 600,
                }}>{p.id}</span>
                <span className="mono" style={{
                  color: 'var(--fg-0)', fontSize: 'var(--fs-xl)',
                }}>{p.handle}</span>
                <Chip kind="neutral">{p.cohort}</Chip>
              </div>
              <div style={{ color: 'var(--fg-1)', fontSize: 'var(--fs-l)' }}>{p.role}</div>
              <div className="hflex gap-2" style={{ flexWrap: 'wrap' }}>
                {topTags.slice(0, 6).map(([t, c]) => (
                  <Chip key={t} kind="neutral">#{t} ×{c}</Chip>
                ))}
              </div>
            </div>
            <div style={{
              width: 280, padding: 'var(--sp-5)', border: '1px solid var(--line)',
              background: 'var(--bg-0)',
            }}>
              <div className="mono uppercase" style={{
                fontSize: 'var(--fs-xs)', color: 'var(--fg-3)', marginBottom: 6,
              }}>OPINION TRAJECTORY</div>
              <Sparkline values={history.slice(0, sim.currentRound + 1)} width={248} height={60} />
              <div className="hflex gap-3" style={{ marginTop: 6 }}>
                <div className="vflex">
                  <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase' }}>INITIAL</span>
                  <span className="mono" style={{ fontSize: 'var(--fs-m)', color: 'var(--fg-1)' }}>
                    {deltaSign(initialStance)}
                  </span>
                </div>
                <div className="vflex">
                  <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase' }}>CURRENT</span>
                  <span className="mono" style={{ fontSize: 'var(--fs-m)', color: stanceColor(currentStance) }}>
                    {deltaSign(currentStance)}
                  </span>
                </div>
                <div className="vflex" style={{ marginLeft: 'auto' }}>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase' }}>NET DRIFT</span>
                  <span className="mono" style={{
                    fontSize: 'var(--fs-m)',
                    color: totalDrift > 0 ? 'var(--sig-agree)' : totalDrift < 0 ? 'var(--sig-oppose)' : 'var(--fg-3)',
                  }}>
                    {deltaSign(totalDrift)} ({stanceLabel(currentStance)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Reaction timeline */}
        <div style={{ padding: 'var(--sp-6)' }}>
          <div className="mono uppercase" style={{
            fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', marginBottom: 10,
            letterSpacing: '0.08em',
          }}>
            REACTION TIMELINE · {visibleRxns.length} of {personRxns.length} shown
          </div>

          <div style={{ position: 'relative' }}>
            {/* vertical spine */}
            <div style={{
              position: 'absolute', left: 56, top: 0, bottom: 0,
              width: 1, background: 'var(--line)',
            }} />
            {personRxns.map((rxn, idx) => {
              const isVisible = visibleRxns.includes(rxn);
              const stanceAfter = sim.stanceHistory[p.id]?.[rxn.round] ?? p.initial;
              const ev = events.find(e => e.round === rxn.round);
              return (
                <div key={idx} style={{
                  display: 'grid',
                  gridTemplateColumns: '56px 1fr',
                  gap: 'var(--sp-5)',
                  marginBottom: 14,
                  opacity: isVisible ? 1 : 0.25,
                }}>
                  <div className="vflex" style={{ alignItems: 'center', position: 'relative', zIndex: 1 }}>
                    <div style={{
                      width: 14, height: 14, background: 'var(--bg-0)',
                      border: `2px solid ${isVisible ? 'var(--amber)' : 'var(--fg-4)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{
                        width: 6, height: 6,
                        background: isVisible ? 'var(--amber)' : 'transparent',
                      }} />
                    </div>
                    <span className="mono" style={{
                      fontSize: 'var(--fs-xs)', color: isVisible ? 'var(--amber)' : 'var(--fg-4)',
                      marginTop: 4, fontWeight: 600,
                    }}>R{String(rxn.round).padStart(2, '0')}</span>
                  </div>
                  <div style={{
                    border: '1px solid var(--line)', background: 'var(--bg-1)', padding: 'var(--sp-5)',
                  }}>
                    <div className="hflex gap-3" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                      <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>{ev?.time}</span>
                      <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>│</span>
                      <span className="ellipsis" style={{ fontSize: 'var(--fs-s)', color: 'var(--fg-2)', flex: 1 }}>
                        {ev?.label}
                      </span>
                      <DeltaChip delta={rxn.delta} />
                      <Chip kind="neutral">→ {deltaSign(stanceAfter)}</Chip>
                    </div>
                    {isVisible ? (
                      <>
                        <div style={{
                          color: 'var(--fg-0)', fontSize: 'var(--fs-l)', lineHeight: 1.5,
                          textWrap: 'pretty',
                        }}>{rxn.text}</div>
                        <div className="hflex gap-2" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                          {rxn.tags?.map(t => <Chip key={t} kind="neutral">#{t}</Chip>)}
                          {rxn.cites?.map((c, i) => (
                            <span key={i} className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-3)' }}>
                              ↪ source: "{c}"
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="mono dim" style={{ fontSize: 'var(--fs-xs)', fontStyle: 'italic' }}>
                        ░ NOT YET STREAMED ░ (round {rxn.round} of {sim.maxRound})
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// REPORT VIEW — end-of-run summary
// ============================================================
function ReportView({ scenario, personas, reactions, sim, events }) {
  // Stats
  const final = personas.map(p => ({
    p,
    initial: p.initial,
    final: sim.stanceHistory[p.id]?.[sim.currentRound] ?? p.initial,
    drift: (sim.stanceHistory[p.id]?.[sim.currentRound] ?? p.initial) - p.initial,
    reactions: reactions.filter(r => r.pid === p.id).length,
  }));

  const tally = {
    endorse: final.filter(f => f.final > 8).length,
    neutral: final.filter(f => f.final >= -8 && f.final <= 8).length,
    oppose: final.filter(f => f.final < -8).length,
  };

  const biggestShifts = [...final].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)).slice(0, 4);

  // Tag frequency
  const tagFreq = {};
  sim.visibleReactions.forEach(r => r.tags?.forEach(t => tagFreq[t] = (tagFreq[t] || 0) + 1));
  const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1.2fr 1fr',
      gap: 1,
      background: 'var(--line)',
      flex: 1, minHeight: 0,
    }}>
      {/* LEFT — narrative + shifts */}
      <div className="vflex" style={{ background: 'var(--bg-0)', overflow: 'auto' }}>
        <div style={{
          padding: 'var(--sp-7)', borderBottom: '1px solid var(--line)', background: 'var(--bg-1)',
        }}>
          <div className="mono uppercase" style={{
            fontSize: 'var(--fs-xs)', color: 'var(--fg-3)', marginBottom: 4, letterSpacing: '0.08em',
          }}>SIMULATION REPORT · {scenario.name}</div>
          <div style={{
            fontSize: 'var(--fs-xxl)', color: 'var(--fg-0)', lineHeight: 1.35, fontWeight: 500,
            textWrap: 'balance', fontFamily: 'var(--sans)',
          }}>
            Across 6 rounds, the simulated audience moved from <span style={{ color: 'var(--fg-2)' }}>mixed</span> to
            <span style={{ color: 'var(--sig-agree)' }}> broadly endorsing</span>, with the remaining skepticism concentrated
            in investor and policy cohorts. The discourse crystallized around <span style={{ color: 'var(--amber)' }}>"SaaS-tax"</span>
            as the organizing frame.
          </div>
        </div>

        <div style={{ padding: 'var(--sp-7)' }}>
          {/* Metrics row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
            background: 'var(--line)', border: '1px solid var(--line)', marginBottom: 20,
          }}>
            {[
              ['PERSONAS', personas.length, 'var(--fg-0)'],
              ['REACTIONS', sim.visibleReactions.length, 'var(--amber)'],
              ['ROUNDS', `${sim.currentRound}/${sim.maxRound}`, 'var(--fg-0)'],
              ['NET SENTIMENT', `+${Math.round(final.reduce((s, f) => s + f.final, 0) / final.length)}`, 'var(--sig-agree)'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ padding: 'var(--sp-5)', background: 'var(--bg-1)' }}>
                <div className="mono uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-3)' }}>{l}</div>
                <div className="mono" style={{ fontSize: 'var(--fs-xxl)', color: c, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Biggest shifts */}
          <div className="mono uppercase" style={{
            fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', marginBottom: 8, letterSpacing: '0.08em',
          }}>LARGEST OPINION SHIFTS</div>
          <div className="vflex gap-1" style={{ marginBottom: 24 }}>
            {biggestShifts.map(f => (
              <div key={f.p.id} style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 80px 80px 120px',
                gap: 'var(--sp-4)', alignItems: 'center',
                padding: '6px 10px', border: '1px solid var(--line)', background: 'var(--bg-1)',
              }}>
                <span className="mono" style={{ color: 'var(--amber)', fontSize: 'var(--fs-s)' }}>{f.p.id}</span>
                <div className="vflex">
                  <span className="mono" style={{ fontSize: 'var(--fs-s)' }}>{f.p.handle}</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{f.p.role}</span>
                </div>
                <span className="mono" style={{ color: 'var(--fg-2)', fontSize: 'var(--fs-s)' }}>{deltaSign(f.initial)}</span>
                <span className="mono" style={{ color: stanceColor(f.final), fontSize: 'var(--fs-s)' }}>{deltaSign(f.final)}</span>
                <div className="hflex gap-2">
                  <span className="mono" style={{
                    fontSize: 'var(--fs-s)', fontWeight: 600,
                    color: f.drift > 0 ? 'var(--sig-agree)' : f.drift < 0 ? 'var(--sig-oppose)' : 'var(--fg-3)',
                  }}>{deltaSign(f.drift)}</span>
                  <Sparkline
                    values={sim.stanceHistory[f.p.id]?.slice(0, sim.currentRound + 1) || []}
                    width={70} height={16}
                    color={f.drift > 0 ? 'var(--sig-agree)' : 'var(--sig-oppose)'}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Consensus themes */}
          <div className="mono uppercase" style={{
            fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', marginBottom: 8, letterSpacing: '0.08em',
          }}>DOMINANT DISCOURSE TAGS</div>
          <div className="hflex gap-2" style={{ flexWrap: 'wrap', marginBottom: 24 }}>
            {topTags.map(([t, c]) => (
              <div key={t} style={{
                padding: '4px 10px',
                background: 'var(--amber-bg)', border: '1px solid var(--amber-line)',
                fontFamily: 'var(--mono)', fontSize: 'var(--fs-s)',
              }}>
                <span style={{ color: 'var(--amber)' }}>#{t}</span>
                <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>×{c}</span>
              </div>
            ))}
          </div>

          {/* Key disagreements — two personas on opposing stances */}
          <div className="mono uppercase" style={{
            fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', marginBottom: 8, letterSpacing: '0.08em',
          }}>KEY DISAGREEMENTS (FINAL STATE)</div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 'var(--sp-4)',
            alignItems: 'center', marginBottom: 8,
          }}>
            <div style={{
              padding: 'var(--sp-5)', background: 'var(--sig-agree-bg)',
              border: '1px solid rgba(125,207,138,0.25)',
            }}>
              <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--sig-agree)', marginBottom: 4 }}>
                P10 devlin_w · CFO
              </div>
              <div style={{ fontSize: 'var(--fs-s)', color: 'var(--fg-0)', lineHeight: 1.45 }}>
                "Signed off. Migrating off the incumbent tool end of month. Net $162k saved annualized."
              </div>
            </div>
            <div className="mono" style={{
              textAlign: 'center', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)',
            }}>VS.</div>
            <div style={{
              padding: 'var(--sp-5)', background: 'var(--sig-oppose-bg)',
              border: '1px solid rgba(232,106,90,0.25)',
            }}>
              <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--sig-oppose)', marginBottom: 4 }}>
                P11 pascale.h · Policy researcher
              </div>
              <div style={{ fontSize: 'var(--fs-s)', color: 'var(--fg-0)', lineHeight: 1.45 }}>
                "Holding position. Will revisit after the first agent-caused incident surfaces in a self-hosted deployment."
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — exports + full persona table */}
      <div className="vflex" style={{ background: 'var(--bg-0)' }}>
        <Panel title="EXPORTS">
          <div style={{ padding: 'var(--sp-6)' }}>
            <div className="vflex gap-3">
              {[
                ['run.json', '284 KB', 'structured simulation output', 'amber'],
                ['summary.md', '12 KB', 'human-readable report', 'neutral'],
                ['reactions.csv', '48 KB', 'flattened reaction log', 'neutral'],
                ['trajectories.csv', '8 KB', 'per-persona stance history', 'neutral'],
              ].map(([name, size, desc, kind]) => (
                <div key={name} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 'var(--sp-4)', alignItems: 'center',
                  padding: '6px 10px', border: '1px solid var(--line)',
                  background: 'var(--bg-1)', cursor: 'pointer',
                }}>
                  <div className="vflex">
                    <span className="mono" style={{ color: kind === 'amber' ? 'var(--amber)' : 'var(--fg-0)', fontSize: 'var(--fs-s)' }}>
                      ▣ {name}
                    </span>
                    <span style={{ color: 'var(--fg-3)', fontSize: 10 }}>{desc}</span>
                  </div>
                  <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>{size}</span>
                  <button className="btn sm">DOWNLOAD</button>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 12, padding: '6px 10px',
              background: 'var(--bg-0)', border: '1px solid var(--line)',
              fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--fg-2)',
            }}>
              OUTPUT DIR: <span style={{ color: 'var(--amber)' }}>~/.missionswarm/runs/{scenario.id}/</span>
            </div>
          </div>
        </Panel>

        <Panel title="FINAL STANCE TABLE" count={personas.length}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>HANDLE</th>
                <th>COHORT</th>
                <th style={{ textAlign: 'right' }}>INIT</th>
                <th style={{ textAlign: 'right' }}>FINAL</th>
                <th style={{ textAlign: 'right' }}>Δ</th>
                <th>TRAJECTORY</th>
              </tr>
            </thead>
            <tbody>
              {final.sort((a, b) => b.final - a.final).map(f => (
                <tr key={f.p.id}>
                  <td style={{ color: 'var(--amber)' }}>{f.p.id}</td>
                  <td>{f.p.handle}</td>
                  <td style={{ color: 'var(--fg-3)' }}>{f.p.cohort}</td>
                  <td style={{ textAlign: 'right', color: 'var(--fg-2)' }}>{deltaSign(f.initial)}</td>
                  <td style={{ textAlign: 'right', color: stanceColor(f.final), fontWeight: 600 }}>
                    {deltaSign(f.final)}
                  </td>
                  <td style={{
                    textAlign: 'right',
                    color: f.drift > 0 ? 'var(--sig-agree)' : f.drift < 0 ? 'var(--sig-oppose)' : 'var(--fg-3)',
                  }}>{deltaSign(f.drift)}</td>
                  <td>
                    <Sparkline
                      values={sim.stanceHistory[f.p.id]?.slice(0, sim.currentRound + 1) || []}
                      width={70} height={14}
                      color={f.drift >= 0 ? 'var(--sig-agree)' : 'var(--sig-oppose)'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

Object.assign(window, { ConfigView, PersonaView, ReportView });
