export const meta = {
  name: 'rbmk-deep-audit',
  description: 'Multi-dimension audit of the RBMK simulator with adversarial verification',
  phases: [
    { title: 'Find', detail: 'six specialist reviewers over physics, numerics, UI, dead code, realism, tests' },
    { title: 'Verify', detail: 'three adversarial skeptics per finding, majority rules' },
  ],
}

const REPO = '/Users/alexanderbass/Developer/projects/rbmk'

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['file', 'line', 'title', 'kind', 'detail', 'fix'],
        properties: {
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'integer' },
          title: { type: 'string', description: 'one-sentence defect statement' },
          kind: { type: 'string', enum: ['bug', 'physics', 'numerics', 'ui', 'perf', 'dead-code', 'realism', 'test-gap'] },
          detail: { type: 'string', description: 'concrete failure scenario: inputs/state -> wrong behavior' },
          fix: { type: 'string', description: 'concrete suggested fix' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is wrong, already handled, or not a real defect' },
    reason: { type: 'string' },
  },
}

const COMMON = `You are auditing a physics-based RBMK-1000 reactor simulator at ${REPO} (Bun + strict TypeScript monorepo). Read ${REPO}/CLAUDE.md first for conventions (CRITICAL: node index 0 = TOP of core; coolant enters BOTTOM; all integrators implicit/semi-implicit by design; sim-core must stay deterministic and framework-free). Sources of truth: packages/sim-core/src/*.ts (physics), packages/ui/src/*.ts + packages/ui/index.html (control room UI), scripts/demo.ts, docs/physics.md and docs/research/*.md (cited facts). Tests in packages/sim-core/test/. Report at most your 12 MOST IMPORTANT findings - quality over quantity; do NOT report style nits, missing features that are documented as roadmap/deferred (plant/turbine/2D radial are deliberately deferred), or intentional simplifications documented in docs/physics.md 'Known simplifications'. Every finding needs a concrete failure scenario. Use Read/Grep/Bash freely; you may run 'cd ${REPO} && bun test' and write scratch scripts under /tmp to check numerics empirically.`

const DIMENSIONS = [
  {
    key: 'physics',
    prompt: `${COMMON}
DIMENSION: physics correctness. Derive and check the actual equations in packages/sim-core/src/{kinetics,isotopes,thermal,rods,field,reactor}.ts against standard reactor physics: point/nodal kinetics with delayed groups, iodine-xenon chain (yields, decay constants, burnup term), inverse-point-kinetics reactimeter (reactor.ts substep), decay-heat groups, boiling channel enthalpy march + void correlation, rod geometry (top-entry absorber + displacer; USP bottom-entry 3.05 m), reactivity bookkeeping (rhoBase calibration, feedback terms, units: absolute rho vs beta). Check UNITS and SIGNS everywhere. Verify the physics claims in code comments match the code. Check the demo operator and Reactor AR controller for physics errors (not tuning choices).`,
  },
  {
    key: 'numerics',
    prompt: `${COMMON}
DIMENSION: numerical robustness. Hunt edge cases and instabilities: division by zero or near-zero (powerFraction ~ 0, flow ~ 0, xeMean, maxRel), the implicit tridiagonal solve in kinetics.ts (denominator sign flips when dt*(rho-beta)/GEN_TIME >= 1 + 2a - can the diagonal cross zero for large dt=0.1 fast-forward with strongly positive local rho? derive the bound and test empirically), semi-implicit updates at dt extremes (0.01 vs 0.1), calibrateCritical bisection failure modes, NaN/Infinity propagation paths, EMA alphas when dt > tau, negative-flux clamps hiding energy-conservation errors, initShutdown/initAtPower re-entrancy (calling them twice, or after scram). Write and run tiny Bun scripts to actually probe suspected instabilities before reporting them.`,
  },
  {
    key: 'ui-logic',
    prompt: `${COMMON}
DIMENSION: UI logic and resource hygiene in packages/ui/src/*.ts + index.html. Look for: stale-state bugs (UI showing controller state that the reactor changed underneath - e.g. after initShutdown/initAtPower do ALL widgets resync: setpoint slider vs reactor.arSetpoint, gradient slider, AR subgroup switch buttons vs rod.autoControlled flags, pw-mode, selection, startupMode, squadCursor, annunciator lampT); event-listener or interval leaks (rebuildSelRows creates lever() listeners on fresh buttons each rebuild - fine - but check window-level listeners); the lever() mouseup-outside-element bug (mousedown on rod-out, drag off, release elsewhere: does the rod keep driving forever?); tooltip stuck states; checklist logic errors; drag-rect vs filter interactions; canvas DPR handling on re-init. Concrete repro steps for each.`,
  },
  {
    key: 'dead-code',
    prompt: `${COMMON}
DIMENSION: dead code, zombies, redundancy. Sweep every export in packages/sim-core/src/index.ts and each module: which exported functions/constants/types are referenced nowhere else (grep across packages/, scripts/)? Which private fields are written but never read? Duplicated logic (e.g. hms() implementations, tooltip wiring repeated three times in main.ts, group-name maps, equilibrium formulas duplicated between modules)? Unused CSS selectors in index.html (check each class/id against the HTML and main.ts)? Leftover scratch/config cruft in the repo root? Report only true zombies - a documented public API used by tests counts as used.`,
  },
  {
    key: 'realism',
    prompt: `${COMMON}
DIMENSION: realism consistency. Cross-check what the code DOES against what docs/physics.md and docs/research/controls.md + startup.md claim, and against the constants' own citations in constants.ts. Examples to check (find more): AZS trip threshold code vs doc (10 s), withdrawal-block 60 s scope (should apply below 5% power only - does the code match the doc?), silovaya blokirovka counts (>=8, AZ excluded), 5-rod selection restriction (non-AZ only), LAR withdraw speed 0.2 asymmetry (insert speed should stay 0.4 - verify), regulator bands (ARM 0.25-6/AR 5-105/LAR 10-100), PRIZMA period 300 s, ORM definition (sum of insertions - is USP included and should it be?), rod stroke 7 m vs research's 6550 mm stroke, USP absorber 3.05 m vs 3500 mm stroke, AZ-5 speed (0.4 m/s -> 17.5 s vs cited <=12-18 s spread), photoneutron/source magnitudes marked ESTIMATED (fine) vs anything claiming a citation it does not have. Flag places where the CODE and the DOCS disagree.`,
  },
  {
    key: 'test-gaps',
    prompt: `${COMMON}
DIMENSION: test coverage gaps that hide risk. Read every test file, then identify the highest-risk UNTESTED behaviors: reactimeter (reactivityBeta) has no test at all despite being a core instrument; AR changeover sequence; azSetback; resetScram then restart; ARM band + LAR dropout-changeover interplay; setRodTarget selector forms (AR1/AR2/AR3, 'all'); rodWorthBeta (no test - signs/restore-state invariants: does it mutate rod.insertion if an exception occurs? no try/finally); field.ts RadialField/quadrants; period-block withdrawal rule; PRIZMA cadence after time jumps; buildRods with count != 211. For each gap: what specific regression could slip through TODAY given recent churn. Propose the exact test (describe assertions). Report the 12 most load-bearing gaps.`,
  },
]

phase('Find')
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA, effort: 'high' }),
  (found, d) => {
    if (!found || !found.findings || found.findings.length === 0) return []
    log(`${d.key}: ${found.findings.length} findings`)
    return parallel(
      found.findings.map((f) => () =>
        parallel(
          ['correctness', 'already-handled', 'reproduce'].map((lens) => () =>
            agent(
              `${COMMON}
You are an adversarial VERIFIER with the ${lens} lens. A reviewer claims the following defect in this repo. Your default position is REFUTED unless you can concretely confirm it by reading the actual code (and running a probe script if numeric). Lenses: correctness = is the claimed behavior actually wrong per physics/spec/docs; already-handled = is it already guarded, documented as intentional (CLAUDE.md, docs/physics.md known-simplifications, deferred roadmap), or fixed; reproduce = can you construct the concrete failing state/steps (for code paths: trace the exact lines; for numerics: run it).
CLAIM: [${f.kind}] ${f.title}
FILE: ${f.file}:${f.line}
SCENARIO: ${f.detail}
PROPOSED FIX: ${f.fix}
Return refuted=true unless the defect is real, unhandled, and consequential.`,
              { label: `verify:${d.key}:${lens}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
            ),
          ),
        ).then((votes) => {
          const ok = votes.filter(Boolean)
          const confirms = ok.filter((v) => !v.refuted).length
          return { ...f, dimension: d.key, confirms, of: ok.length, reasons: ok.map((v) => (v.refuted ? 'REF: ' : 'OK: ') + v.reason.slice(0, 200)) }
        }),
      ),
    )
  },
)

const all = results.filter(Boolean).flat().filter(Boolean)
const confirmed = all.filter((f) => f.confirms >= 2)
const uncertain = all.filter((f) => f.confirms === 1)
log(`confirmed: ${confirmed.length}, uncertain: ${uncertain.length}, rejected: ${all.length - confirmed.length - uncertain.length}`)
return { confirmed, uncertain }