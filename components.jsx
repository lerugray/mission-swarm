// Shared primitives + simulation engine state
// Exports everything onto window so subsequent babel scripts can use them.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============ Stance helpers ============
function stanceColor(v) {
  if (v > 35) return 'var(--sig-agree)';
  if (v > 10) return 'color-mix(in oklab, var(--sig-agree) 70%, var(--fg-1))';
  if (v > -10) return 'var(--fg-2)';
  if (v > -35) return 'color-mix(in oklab, var(--sig-oppose) 70%, var(--fg-1))';
  return 'var(--sig-oppose)';
}
function stanceLabel(v) {
  if (v > 60) return 'STRONG ENDORSE';
  if (v > 25) return 'ENDORSE';
  if (v > 8) return 'LEAN POS';
  if (v > -8) return 'NEUTRAL';
  if (v > -25) return 'LEAN NEG';
  if (v > -60) return 'OPPOSE';
  return 'STRONG OPPOSE';
}
function stanceGlyph(v) {
  // A 9-step glyph used in dense lists: compressed to a single token.
  if (v > 70) return '╋╋';
  if (v > 40) return '╋ ';
  if (v > 15) return '┼ ';
  if (v > -15) return '─ ';
  if (v > -40) return '┤ ';
  if (v > -70) return '┠ ';
  return '┨┨';
}
function deltaSign(d) {
  if (d > 0) return `+${d}`;
  if (d === 0) return '±0';
  return `${d}`;
}

// Build per-persona stance history over rounds by summing deltas onto initial
function buildStanceHistory(personas, reactions, maxRound) {
  const history = {};
  personas.forEach(p => {
    history[p.id] = [p.initial]; // history[id][0] = initial
  });
  for (let r = 1; r <= maxRound; r++) {
    personas.forEach(p => {
      const last = history[p.id][r - 1];
      const rxnThisRound = reactions.filter(x => x.pid === p.id && x.round === r);
      const totalDelta = rxnThisRound.reduce((s, x) => s + x.delta, 0);
      history[p.id].push(Math.max(-100, Math.min(100, last + totalDelta)));
    });
  }
  return history;
}

// ============ Primitives ============

function Chip({ children, kind = 'neutral', className = '', ...rest }) {
  return (
    <span className={`chip ${kind} ${className}`} {...rest}>{children}</span>
  );
}

function Kbd({ children }) { return <span className="kbd">{children}</span>; }

function LiveDot() { return <span className="live-dot" />; }

function Panel({ title, count, right, className = '', children, bodyStyle, bodyClass = '' }) {
  return (
    <div className={`panel ${className}`}>
      {(title || right) && (
        <div className="panel-header">
          {title && <span className="title">{title}</span>}
          {count != null && <span className="count">{count}</span>}
          {right && <div className="panel-header-right">{right}</div>}
        </div>
      )}
      <div className={`panel-body ${bodyClass}`} style={bodyStyle}>{children}</div>
    </div>
  );
}

// Inline sparkline — simple polyline, no animation, no axes
function Sparkline({ values, width = 80, height = 20, color = 'var(--amber)', domain = [-100, 100], showZero = true }) {
  if (!values || values.length === 0) return null;
  const [min, max] = domain;
  const w = width, h = height;
  const stepX = values.length > 1 ? w / (values.length - 1) : w;
  const y = (v) => h - ((v - min) / (max - min)) * h;
  const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zeroY = y(0);
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {showZero && (
        <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 2" />
      )}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="miter" strokeLinecap="butt" />
      {values.map((v, i) => (
        <circle key={i} cx={i * stepX} cy={y(v)} r={i === values.length - 1 ? 2 : 1} fill={color} />
      ))}
    </svg>
  );
}

// Horizontal stance bar — a line with a position marker
function StanceBar({ value, width = 70 }) {
  const pct = ((value + 100) / 200) * 100;
  const color = stanceColor(value);
  return (
    <div style={{ width, height: 10, position: 'relative', display: 'flex', alignItems: 'center' }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '50%', height: 1,
        background: 'var(--line)', transform: 'translateY(-50%)',
      }} />
      <div style={{
        position: 'absolute', left: '50%', top: 1, bottom: 1, width: 1,
        background: 'var(--bg-4)',
      }} />
      <div style={{
        position: 'absolute', left: `calc(${pct}% - 3px)`, top: '50%',
        width: 6, height: 6, background: color, transform: 'translateY(-50%)',
        boxShadow: `0 0 4px ${color}`,
      }} />
    </div>
  );
}

// Delta chip
function DeltaChip({ delta }) {
  if (delta === 0) return <Chip kind="neutral">±0</Chip>;
  if (delta > 0) return <Chip kind="agree">+{delta}</Chip>;
  return <Chip kind="oppose">{delta}</Chip>;
}

// ============ Simulation engine ============
// Drives the round counter + reveals reactions over time.
function useSimulation(scenario, personas, reactions, events) {
  // currentRound: highest round that is "done"
  // streamCursor: index into reactions[] up to which we've shown
  const [currentRound, setCurrentRound] = useState(0);
  const [streamCursor, setStreamCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pacing, setPacing] = useState(scenario.config.pacing_sec); // seconds per round
  const [budgetSpent, setBudgetSpent] = useState(scenario.budget.spent_usd);
  const [tokensUsed, setTokensUsed] = useState(scenario.budget.tokens);
  const [elapsed, setElapsed] = useState(0);

  const maxRound = scenario.config.rounds;
  const sortedReactions = useMemo(
    () => reactions.slice().sort((a, b) => a.round - b.round || a.pid.localeCompare(b.pid)),
    [reactions]
  );

  // tick: progressively reveal reactions within the current round, then advance
  useEffect(() => {
    if (!playing) return;
    const msPerReaction = (pacing * 1000) / Math.max(1, sortedReactions.filter(r => r.round === Math.max(1, currentRound + 1)).length || 1);
    const t = setInterval(() => {
      setStreamCursor(prev => {
        const next = prev + 1;
        if (next > sortedReactions.length) {
          setPlaying(false);
          return prev;
        }
        // advance round if we've crossed a boundary
        const newRound = sortedReactions[next - 1].round;
        setCurrentRound(r => Math.max(r, newRound));
        setBudgetSpent(s => s + 0.012 + Math.random() * 0.008);
        setTokensUsed(tk => tk + 1800 + Math.floor(Math.random() * 1200));
        setElapsed(e => e + msPerReaction / 1000);
        return next;
      });
    }, Math.max(120, msPerReaction));
    return () => clearInterval(t);
  }, [playing, pacing, sortedReactions, currentRound]);

  const step = useCallback(() => {
    setStreamCursor(prev => {
      // step forward by one round
      const nextRound = Math.min(maxRound, (currentRound || 0) + 1);
      const lastIdxForRound = sortedReactions.findIndex(r => r.round > nextRound);
      const cursor = lastIdxForRound === -1 ? sortedReactions.length : lastIdxForRound;
      setCurrentRound(nextRound);
      setBudgetSpent(s => s + (cursor - prev) * 0.014);
      setTokensUsed(tk => tk + (cursor - prev) * 2100);
      setElapsed(e => e + pacing);
      return cursor;
    });
  }, [currentRound, maxRound, sortedReactions, pacing]);

  const reset = useCallback(() => {
    setCurrentRound(0);
    setStreamCursor(0);
    setPlaying(false);
    setBudgetSpent(0.08);
    setTokensUsed(4200);
    setElapsed(0);
  }, []);

  const seekToEnd = useCallback(() => {
    setCurrentRound(maxRound);
    setStreamCursor(sortedReactions.length);
    setPlaying(false);
    setBudgetSpent(scenario.budget.spent_usd);
    setTokensUsed(scenario.budget.tokens);
    setElapsed(maxRound * pacing);
  }, [maxRound, sortedReactions, pacing, scenario]);

  const visibleReactions = sortedReactions.slice(0, streamCursor);
  const stanceHistory = useMemo(
    () => buildStanceHistory(personas, visibleReactions, currentRound),
    [personas, visibleReactions, currentRound]
  );

  return {
    currentRound, maxRound, playing, setPlaying,
    pacing, setPacing,
    visibleReactions, sortedReactions,
    stanceHistory,
    step, reset, seekToEnd,
    budgetSpent, tokensUsed, elapsed,
    totalReactions: sortedReactions.length,
    cursor: streamCursor,
  };
}

// ============ Top bar ============
function TopBar({ view, setView, sim, scenario }) {
  const tabs = [
    { id: 'config',   label: 'CONFIG',   hk: '1' },
    { id: 'stream',   label: 'STREAM',   hk: '2' },
    { id: 'persona',  label: 'PERSONAS', hk: '3' },
    { id: 'report',   label: 'REPORT',   hk: '4' },
  ];
  return (
    <div className="topbar">
      <div className="topbar-brand">MISSIONSWARM</div>
      <div className="topbar-nav">
        {tabs.map(t => (
          <div key={t.id} className={`topbar-tab ${view === t.id ? 'active' : ''}`} onClick={() => setView(t.id)}>
            <span>{t.label}</span><span className="hk">{t.hk}</span>
          </div>
        ))}
      </div>
      <div className="topbar-right">
        <span className="pill">OPENROUTER</span>
        <span>{scenario.name}</span>
        <span className="mono">R{String(sim.currentRound).padStart(2, '0')}/{String(sim.maxRound).padStart(2, '0')}</span>
      </div>
    </div>
  );
}

// ============ Status bar ============
function StatusBar({ sim, scenario }) {
  const pct = Math.round((sim.budgetSpent / scenario.budget.budget_usd) * 100);
  return (
    <div className="statusbar">
      <div className="statusbar-cell">
        <span className="statusbar-label">SIM</span>
        <span>{scenario.name}</span>
      </div>
      <div className="statusbar-cell">
        <span className="statusbar-label">ROUND</span>
        <span className="accent">{String(sim.currentRound).padStart(2, '0')}/{String(sim.maxRound).padStart(2, '0')}</span>
      </div>
      <div className="statusbar-cell">
        <span className="statusbar-label">RXN</span>
        <span>{sim.cursor}/{sim.totalReactions}</span>
      </div>
      <div className="statusbar-cell">
        <span className="statusbar-label">PROV</span>
        <span>{scenario.config.provider}:{scenario.config.model.split('/').pop()}</span>
      </div>
      <div className="statusbar-cell">
        <span className="statusbar-label">TOKENS</span>
        <span>{(sim.tokensUsed / 1000).toFixed(1)}k</span>
      </div>
      <div className="statusbar-cell">
        <span className="statusbar-label">COST</span>
        <span className={pct > 80 ? 'accent' : ''}>${sim.budgetSpent.toFixed(2)}/${scenario.budget.budget_usd.toFixed(2)}</span>
      </div>
      <div className="statusbar-cell">
        <span className="statusbar-label">ELAPSED</span>
        <span>{Math.floor(sim.elapsed / 60).toString().padStart(2, '0')}:{Math.floor(sim.elapsed % 60).toString().padStart(2, '0')}</span>
      </div>
      <div className="statusbar-cell right">
        <span className="statusbar-label">STATUS</span>
        <span className="accent">{sim.playing ? <><span className="blink">●</span> STREAMING</> : (sim.cursor === 0 ? 'IDLE' : sim.cursor === sim.totalReactions ? 'COMPLETE' : 'PAUSED')}</span>
      </div>
    </div>
  );
}

Object.assign(window, {
  stanceColor, stanceLabel, stanceGlyph, deltaSign, buildStanceHistory,
  Chip, Kbd, LiveDot, Panel, Sparkline, StanceBar, DeltaChip,
  useSimulation, TopBar, StatusBar,
});
