// Main app — wires views, top bar, status bar, tweaks panel, keyboard shortcuts.

const { useState: useStateApp, useEffect: useEffectApp } = React;

function App() {
  const tweakDefaults = /*EDITMODE-BEGIN*/{
    "density": "dense",
    "accent": "amber",
    "variant": "A",
    "mono_reactions": false,
    "light": false,
    "scanlines": false
  }/*EDITMODE-END*/;

  const [tweaks, setTweak] = useTweaks(tweakDefaults);
  const [view, setView] = useStateApp('config');
  const [selectedPid, setSelectedPid] = useStateApp(window.PERSONAS[0].id);

  const scenario = window.SCENARIO;
  const personas = window.PERSONAS;
  const reactions = window.REACTIONS;
  const events = window.ROUND_EVENTS;

  const sim = useSimulation(scenario, personas, reactions, events);
  const personaIdx = usePersonaIndex(personas);

  // Start seeded at round 3 so demo looks alive on first load
  useEffectApp(() => {
    const seedCursor = reactions.filter(r => r.round <= 3).length;
    if (sim.cursor === 0) {
      // programmatic seed by stepping
      sim.step(); sim.step(); sim.step();
    }
    // eslint-disable-next-line
  }, []);

  // Apply accent + light mode
  useEffectApp(() => {
    document.body.classList.toggle('light', !!tweaks.light);
    document.documentElement.style.setProperty('--density-override', tweaks.density);
    const accentMap = {
      amber:  { amber: '#ffa630', dim: '#c67d1e' },
      cyan:   { amber: '#5fc9d9', dim: '#3d95a3' },
      green:  { amber: '#7dd87a', dim: '#4fa44c' },
      magenta:{ amber: '#e06ab5', dim: '#a54787' },
    };
    const c = accentMap[tweaks.accent] || accentMap.amber;
    document.documentElement.style.setProperty('--amber', c.amber);
    document.documentElement.style.setProperty('--amber-dim', c.dim);
    document.documentElement.style.setProperty('--amber-bg', `color-mix(in oklab, ${c.amber} 10%, transparent)`);
    document.documentElement.style.setProperty('--amber-bg-2', `color-mix(in oklab, ${c.amber} 18%, transparent)`);
    document.documentElement.style.setProperty('--amber-line', `color-mix(in oklab, ${c.amber} 34%, transparent)`);
  }, [tweaks.accent, tweaks.light, tweaks.density]);

  // Keyboard shortcuts
  useEffectApp(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '1') setView('config');
      else if (e.key === '2') setView('stream');
      else if (e.key === '3') setView('persona');
      else if (e.key === '4') setView('report');
      else if (e.key === ' ') { e.preventDefault(); sim.setPlaying(p => !p); }
      else if (e.key === 'ArrowRight') sim.step();
      else if (e.key === 'r' || e.key === 'R') sim.reset();
      else if (e.key === 'End') sim.seekToEnd();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sim]);

  const densityClass = tweaks.density === 'comfortable' ? 'density-comfortable'
    : tweaks.density === 'extreme' ? 'density-extreme' : '';

  return (
    <div className={`app ${densityClass} ${tweaks.mono_reactions ? 'mono-reactions' : ''}`}
      data-screen-label={view === 'config' ? '01 Config' : view === 'stream' ? `02 Stream (${tweaks.variant})` : view === 'persona' ? '03 Persona' : '04 Report'}
    >
      <TopBar view={view} setView={setView} sim={sim} scenario={scenario} />

      <div className="vflex" style={{ overflow: 'hidden', minHeight: 0 }}>
        {view === 'config' && (
          <ConfigView scenario={scenario} personas={personas} onStart={() => { sim.reset(); sim.setPlaying(true); setView('stream'); }} sim={sim} />
        )}
        {view === 'stream' && (
          <>
            <StreamToolbar sim={sim} variant={tweaks.variant} setVariant={(v) => setTweak('variant', v)} />
            {tweaks.variant === 'A' && (
              <StreamVariantA sim={sim} scenario={scenario} personas={personas} events={events}
                personaIdx={personaIdx}
                onPersonaClick={(pid) => { setSelectedPid(pid); setView('persona'); }}
                density={tweaks.density}
              />
            )}
            {tweaks.variant === 'B' && (
              <StreamVariantB sim={sim} scenario={scenario} personas={personas} events={events}
                personaIdx={personaIdx}
                onPersonaClick={(pid) => { setSelectedPid(pid); setView('persona'); }}
              />
            )}
            {tweaks.variant === 'C' && (
              <StreamVariantC sim={sim} scenario={scenario} personas={personas} events={events}
                personaIdx={personaIdx}
                onPersonaClick={(pid) => { setSelectedPid(pid); setView('persona'); }}
              />
            )}
          </>
        )}
        {view === 'persona' && (
          <PersonaView personas={personas} reactions={reactions} sim={sim} scenario={scenario}
            events={events} selectedPid={selectedPid} setSelectedPid={setSelectedPid}
          />
        )}
        {view === 'report' && (
          <ReportView scenario={scenario} personas={personas} reactions={reactions} sim={sim} events={events} />
        )}
      </div>

      <StatusBar sim={sim} scenario={scenario} />

      {tweaks.scanlines && (
        <div style={{
          pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 999,
          background: 'repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,0.18) 2px 3px)',
          mixBlendMode: 'multiply',
        }} />
      )}

      <TweaksPanel title="TWEAKS">
        <TweakSection title="Layout">
          <TweakRadio label="Stream variant" value={tweaks.variant} onChange={(v) => setTweak('variant', v)}
            options={[
              { value: 'A', label: 'A · Ledger' },
              { value: 'B', label: 'B · Opposition' },
              { value: 'C', label: 'C · Matrix' },
            ]}
          />
          <TweakRadio label="Density" value={tweaks.density} onChange={(v) => setTweak('density', v)}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'dense', label: 'Dense (default)' },
              { value: 'extreme', label: 'Extreme' },
            ]}
          />
        </TweakSection>
        <TweakSection title="Signal palette">
          <TweakRadio label="Accent" value={tweaks.accent} onChange={(v) => setTweak('accent', v)}
            options={[
              { value: 'amber', label: 'Amber (terminal)' },
              { value: 'cyan', label: 'Cyan (CIC)' },
              { value: 'green', label: 'Green phosphor' },
              { value: 'magenta', label: 'Magenta' },
            ]}
          />
        </TweakSection>
        <TweakSection title="Style">
          <TweakToggle label="Light mode" value={tweaks.light} onChange={(v) => setTweak('light', v)} />
          <TweakToggle label="CRT scanlines" value={tweaks.scanlines} onChange={(v) => setTweak('scanlines', v)} />
          <TweakToggle label="Mono reaction text" value={tweaks.mono_reactions} onChange={(v) => setTweak('mono_reactions', v)} />
        </TweakSection>
        <TweakSection title="Shortcuts">
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.8 }}>
            <div><span className="kbd">1</span>–<span className="kbd">4</span> switch views</div>
            <div><span className="kbd">SPACE</span> play / pause stream</div>
            <div><span className="kbd">→</span> step one round</div>
            <div><span className="kbd">R</span> reset · <span className="kbd">END</span> seek to end</div>
          </div>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// mono-reactions modifier hooked to .mono-reactions class
const style = document.createElement('style');
style.textContent = `.mono-reactions .panel-body { font-family: var(--mono); }`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
