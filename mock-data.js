// Mock data for the GeneralStaff press-release scenario
// MissionSwarm is simulating 14 personas reacting to the launch of GeneralStaff,
// an open-source, BYOK, local-first alternative to Polsia (AI-agent-orchestration SaaS).

window.SCENARIO = {
  id: "sim_2026_04_23_generalstaff",
  name: "GENERALSTAFF-LAUNCH-01",
  document: {
    title: "GeneralStaff 0.1 — Open-Source Agent Orchestration, BYOK, Local-First",
    source: "press release / Show HN post",
    date: "2026-04-23",
    excerpt: `GeneralStaff is an open-source alternative to Polsia. It orchestrates
AI agents that run your business operations — sales follow-up, invoice
reconciliation, pipeline triage, vendor comms — but runs entirely on your own
infrastructure. Bring your own keys (Anthropic, OpenAI, OpenRouter, Ollama).
No SaaS tax. No data leaves your VPC. MIT licensed. One binary, one config.

We think the autonomous-agent category is going to split along the same line
every infra category splits along: managed SaaS for teams that want a vendor,
self-hosted for teams that don't. GeneralStaff is for the second group.`,
  },
  config: {
    rounds: 6,
    pacing_sec: 4,
    persona_count: 14,
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.5",
    dry_run: false,
  },
  budget: { spent_usd: 0.47, budget_usd: 2.50, tokens: 284_119 },
};

// 14 personas — each has a handle, role, stance vector, and a prior disposition.
// stance: -100 (strongly opposed) .. 0 (neutral) .. +100 (strongly endorsing)
window.PERSONAS = [
  { id: "P01", handle: "harlow.s",     role: "CTO, Series B fintech",          cohort: "operator",    initial: +32, volatility: 0.4 },
  { id: "P02", handle: "vega_ops",     role: "RevOps lead, 120-person SaaS",   cohort: "operator",    initial:  +8, volatility: 0.6 },
  { id: "P03", handle: "m_lindqvist",  role: "Partner, enterprise VC",         cohort: "investor",    initial: -18, volatility: 0.3 },
  { id: "P04", handle: "okafor.a",     role: "Head of IT, regional bank",      cohort: "enterprise",  initial: +54, volatility: 0.2 },
  { id: "P05", handle: "jules_r",      role: "Solo founder, B2B SaaS",         cohort: "operator",    initial: +41, volatility: 0.5 },
  { id: "P06", handle: "saburo.t",     role: "Compliance officer, insurer",    cohort: "enterprise",  initial: +62, volatility: 0.2 },
  { id: "P07", handle: "ren.k",        role: "Staff engineer, infra",          cohort: "engineer",    initial: +38, volatility: 0.5 },
  { id: "P08", handle: "quartz_pm",    role: "PM at Polsia competitor",        cohort: "industry",    initial: -44, volatility: 0.6 },
  { id: "P09", handle: "oriana.m",     role: "Tech journalist, enterprise beat", cohort: "media",     initial:  -6, volatility: 0.4 },
  { id: "P10", handle: "devlin_w",     role: "CFO, 40-person services co",     cohort: "operator",    initial: +70, volatility: 0.3 },
  { id: "P11", handle: "pascale.h",    role: "AI-skeptic policy researcher",   cohort: "skeptic",     initial: -52, volatility: 0.3 },
  { id: "P12", handle: "kassian",      role: "OSS maintainer, adjacent tool",  cohort: "engineer",    initial: +28, volatility: 0.6 },
  { id: "P13", handle: "mira_dx",      role: "DevRel, LLM platform",           cohort: "industry",    initial:  +4, volatility: 0.5 },
  { id: "P14", handle: "torres.e",     role: "IT director, municipal gov",     cohort: "enterprise",  initial: +46, volatility: 0.3 },
];

// Hand-authored reactions across 6 rounds. Each reaction has:
//   persona_id, round, text, delta (stance change this round), tags, cites
// Writing these to feel like real operator/analyst reactions — not AI-assistant-voice.
window.REACTIONS = [
  // ROUND 1 — initial scan of the press release
  { pid:"P01", round:1, delta:+4,  tags:["supply-chain","sovereignty"], cites:["no data leaves your VPC"],
    text:"BYOK + self-hosted addresses the one thing that actually blocks us from shipping agents into prod. Not pricing. Audit trail. If the keys and the logs both live in our VPC, legal stops nack'ing the rollout." },
  { pid:"P03", round:1, delta:-6,  tags:["moat","distribution"],
    text:"The Polsia thesis was never the runtime. It's the distribution + managed ops. Open-sourcing the orchestrator is table stakes now — doesn't change who wins enterprise deals. MIT licensed runtimes don't get renewed, they get maintained." },
  { pid:"P04", round:1, delta:+12, tags:["compliance","procurement"],
    text:"This is the first agent product I can actually put through procurement without a 9-month InfoSec review. Self-hosted, MIT, no third-party data path. Forwarding to the security team today." },
  { pid:"P06", round:1, delta:+14, tags:["compliance","residency"], cites:["no data leaves your VPC"],
    text:"Data residency is not a feature, it's a regulatory requirement in 4 of our 6 markets. Any agent tool that sends a single token to a vendor-hosted inference endpoint is DOA for us. Finally." },
  { pid:"P08", round:1, delta:-8,  tags:["competitive","fud"],
    text:"Show HN launch with a README and a Discord isn't a replacement for a company with SLAs. You can't page an MIT license at 3am when agents are misfiring against your prod CRM." },
  { pid:"P11", round:1, delta:-4,  tags:["systemic","risk"],
    text:"\"AI that runs your company while you sleep\" was already a failure mode waiting to happen. Making it easier to self-host doesn't make it safer — it makes the blast radius private and un-auditable by anyone outside the operator." },
  { pid:"P10", round:1, delta:+6,  tags:["cost","unit-economics"],
    text:"$0 per seat, per month, per agent, per action. The SaaS tax on this category was going to hit $40k/yr for a team our size by Q3. Paying Anthropic directly is going to be a fraction of that." },
  { pid:"P13", round:1, delta:+2,  tags:["ecosystem"],
    text:"Seeing OpenRouter and Ollama as peer citizens with the big-lab providers is the right default. The managed-SaaS orchestrators all soft-gate Ollama behind enterprise tiers because it doesn't pay them a margin." },

  // ROUND 2 — reading the README + trying the binary
  { pid:"P01", round:2, delta:+2,  tags:["dx","install"],
    text:"Single binary, one TOML config, up in 4 minutes on a spare EC2. This is the install story Polsia never had. 14-step onboarding wizard vs. `./generalstaff up`." },
  { pid:"P02", round:2, delta:+8,  tags:["dx","first-run"],
    text:"First-run wizard is rough but functional. Missing a dry-run mode for agent plans — without it I'm not letting this touch Salesforce. Filed an issue, got a reply in 40 minutes. That's already better support than our $28k/yr vendor." },
  { pid:"P05", round:2, delta:+10, tags:["dx","indie"],
    text:"I'm a team of one. The fact that I can run this on a $12/mo droplet and not get nickel-and-dimed per agent action is the difference between me using it and me not automating at all." },
  { pid:"P07", round:2, delta:+4,  tags:["architecture"],
    text:"Orchestrator is a straightforward state machine with a pluggable executor. No magic. No \"our proprietary reasoning engine.\" The code reads like it was written by someone who's had to debug production agents at 2am." },
  { pid:"P09", round:2, delta:+6,  tags:["narrative","framing"],
    text:"The \"SaaS tax\" framing is going to land. Every founder I've talked to in the last 3 months has the same complaint about the autonomous-agents category: per-action pricing on top of per-seat pricing on top of inference costs. This reframes it." },
  { pid:"P08", round:2, delta:-4,  tags:["competitive"],
    text:"README is strong. But there's no multi-tenant story, no RBAC beyond a single admin, no SSO. They're not competing with us in enterprise — they're competing with devs running a single-user tool. Different market." },
  { pid:"P12", round:2, delta:+10, tags:["ecosystem","license"],
    text:"MIT not AGPL is the right call for adoption. The Polsia-alikes will fork this, and that's fine — the maintainers clearly knew that and accepted it. This is how the Postgres of agent runtimes gets chosen." },

  // ROUND 3 — the discourse starts
  { pid:"P03", round:3, delta:-10, tags:["moat","distribution"],
    text:"Watching the HN thread. 2,400 upvotes and the top comment is a feature request. That's a strong launch and a weak business. Who's maintaining this in 18 months when the three founders take the Anthropic offer?" },
  { pid:"P08", round:3, delta:+6,  tags:["reality-check"],
    text:"Okay — pulled the binary, ran it against our test Salesforce sandbox. The agent-plan preview is genuinely well done. I've been underweighting this." },
  { pid:"P11", round:3, delta:-8,  tags:["risk","governance"],
    text:"\"Audit trail lives in your VPC\" means nobody outside the operator sees it. That's a feature to enterprise IT and a bug to every regulator who will eventually need to subpoena these logs." },
  { pid:"P14", round:3, delta:+8,  tags:["procurement","gov"],
    text:"For municipal gov, SaaS AI is effectively prohibited in 19 states under current procurement rules. Self-hosted MIT-licensed is the only path. This is the first tool in the category that's even buyable for us." },
  { pid:"P06", round:3, delta:+4,  tags:["audit"],
    text:"Audit log format is structured JSON with per-action signatures. Can pipe it straight to Splunk. That alone would take 6 months to build in-house." },
  { pid:"P13", round:3, delta:+6,  tags:["ecosystem","platform"],
    text:"From a platform-side view: this is good for us. Every team that runs GeneralStaff is a team buying more tokens from our API. Managed orchestrators compress margins; self-hosted runtimes expand them." },
  { pid:"P02", round:3, delta:-6,  tags:["dx","gaps"],
    text:"Hit the first real wall: no approval-queue UI. If an agent wants to send a $14k invoice, I need a human in the loop and there's no primitive for that yet. Docs say it's on the roadmap. That's not a Q2 answer." },

  // ROUND 4 — positions harden, new info lands (maintainer AMA)
  { pid:"P01", round:4, delta:+6,  tags:["governance","approval"],
    text:"Maintainer confirmed in the AMA that approval-queue is shipping in 0.2, next month. The roadmap is public, issues are public, the core team is responsive. That's enough for me to greenlight a pilot." },
  { pid:"P04", round:4, delta:+4,  tags:["procurement"],
    text:"Security team came back: MIT + self-hosted + signed binaries + reproducible builds. Cleared for internal eval. This is faster than any vendor clearance we've done in 3 years." },
  { pid:"P05", round:4, delta:+8,  tags:["indie","outcome"],
    text:"Ran it end-to-end on my invoice-reconciliation workflow. Caught a $3,200 duplicate I'd been eating for two months. I don't need more convincing." },
  { pid:"P09", round:4, delta:+2,  tags:["narrative"],
    text:"Writing this up. The story isn't \"open-source alternative.\" It's \"the agent category has a SaaS-tax problem and the open-source release is the proof.\" Polsia's response will tell us how real the thesis is." },
  { pid:"P03", round:4, delta:-4,  tags:["moat"],
    text:"I'll grant the launch is working. I won't grant that this changes the enterprise-procurement motion. The teams that can self-host are a fraction of the TAM. The rest still need a throat to choke." },
  { pid:"P08", round:4, delta:+8,  tags:["pivot"],
    text:"Internal conversation today: we need a self-hosted tier. The category is bifurcating and we picked one side. That's on us, not on them." },
  { pid:"P11", round:4, delta:-2,  tags:["risk"],
    text:"Revising slightly. The audit-log design is more thoughtful than I expected — signed, append-only, exportable. Doesn't solve governance but it makes governance possible. That's a distinction I was collapsing." },
  { pid:"P07", round:4, delta:+6,  tags:["architecture"],
    text:"Read the executor source. Retries are idempotent-by-default, side-effects are declared up front, you can dry-run any plan. This is how you build agent infra if you've been burned before." },
  { pid:"P12", round:4, delta:+6,  tags:["ecosystem"],
    text:"First PR merged — added a Gemini provider. 4-hour turnaround on review. Maintainers are serious. This will have 40 providers by year end." },

  // ROUND 5 — the consensus forms
  { pid:"P10", round:5, delta:+4,  tags:["cost"],
    text:"Ran the 12-month TCO. Self-hosted GeneralStaff + direct Anthropic billing comes in at 22% of the Polsia quote for the same workload scope. I'm not going to defend paying 4.5x for a vendor relationship." },
  { pid:"P06", round:5, delta:+6,  tags:["compliance","buy"],
    text:"Cleared for production rollout. 80 seats Q3, full deployment Q4. This is the first time in my career a compliance-blocker category has been solved by the open-source option arriving before the enterprise one." },
  { pid:"P02", round:5, delta:+10, tags:["dx","win"],
    text:"0.2 preview has the approval queue. Wired it up to Slack, set the threshold at $5k. Feels like the missing primitive just appeared. We're in." },
  { pid:"P13", round:5, delta:+4,  tags:["ecosystem"],
    text:"Token volume from GeneralStaff deployments surfaced on our dashboards today. 3 weeks post-launch. This is going faster than anything I've seen in this category." },
  { pid:"P14", round:5, delta:+4,  tags:["gov"],
    text:"State procurement got it on the approved-tools list in 11 days. Record for us. Usually 9 months." },
  { pid:"P09", round:5, delta:+4,  tags:["narrative"],
    text:"Piece published. Title: \"The Agent SaaS Tax Is Over.\" Early read numbers suggest the framing is landing in the operator audience, not the VC audience. That's the right audience for this." },
  { pid:"P03", round:5, delta:+2,  tags:["moat","concede"],
    text:"Updating my prior. The distribution story is weaker than I thought because the product removes the thing vendors were selling. Not a full reversal — but the category margins are going to compress faster than the deck I had." },
  { pid:"P11", round:5, delta:+2,  tags:["governance"],
    text:"Still think the systemic risks haven't been solved — they've been decentralized. But decentralized and auditable beats centralized and opaque. Small update in a cautious direction." },

  // ROUND 6 — stable state, late signals
  { pid:"P01", round:6, delta:+2,  tags:["ship"],
    text:"Production. 11 agents running. No incidents. Moving on to what we're automating next." },
  { pid:"P04", round:6, delta:+2,  tags:["ship"],
    text:"Branch deployment across 3 regional offices. Security sign-off, legal sign-off, IT sign-off, all in the same quarter. Unprecedented." },
  { pid:"P08", round:6, delta:+4,  tags:["market"],
    text:"Our board approved a self-hosted tier yesterday. Six months ago that would have been a religious argument. Market moved." },
  { pid:"P03", round:6, delta:-2,  tags:["moat"],
    text:"Final position: the open-source release is real, the category compression is real, the enterprise-distribution moat is smaller than I was underwriting. Revising the portfolio." },
  { pid:"P10", round:6, delta:+2,  tags:["cost"],
    text:"Signed off. Migrating off the incumbent tool end of month. Net $162k saved annualized." },
  { pid:"P11", round:6, delta:+0,  tags:["watch"],
    text:"Holding position. Will revisit in 6 months after the first agent-caused incident surfaces in a self-hosted deployment and we see how the postmortem ecosystem handles it." },
  { pid:"P12", round:6, delta:+4,  tags:["ecosystem"],
    text:"17 providers merged. 140 contributors. The fork ecosystem is already forming. This is the shape of a real thing." },
  { pid:"P07", round:6, delta:+2,  tags:["architecture"],
    text:"Running it in prod. It's boring in exactly the way good infrastructure should be boring." },
];

// Round-level events (operator-scheduled inputs)
window.ROUND_EVENTS = [
  { round: 1, label: "Press release + Show HN post published",   time: "T+00:00" },
  { round: 2, label: "Binary + README circulated widely",         time: "T+04:00" },
  { round: 3, label: "HN thread hits 2.4k upvotes; discourse opens", time: "T+08:00" },
  { round: 4, label: "Maintainer AMA; 0.2 roadmap disclosed",     time: "T+12:00" },
  { round: 5, label: "0.2 ships with approval-queue primitive",   time: "T+16:00" },
  { round: 6, label: "3 weeks post-launch — stable-state snapshot", time: "T+20:00" },
];
