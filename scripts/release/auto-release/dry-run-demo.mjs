import { fixture, SHA_B } from './fixture.mjs'
import { publishRelease } from './publish.mjs'
const f = fixture()
const result = await publishRelease(f.config, f.services)
const again = await publishRelease(f.config, f.services)
if (f.state.writes.length || result.planHash !== again.planHash)
  throw Error('Dry-run performed a write or changed identity')
const initial = fixture({ initialized: false })
const baseline = await publishRelease(initial.config, initial.services, {
  mode: 'initialize',
  baselineSha: SHA_B,
  baselineVersion: 'v1.0.0',
})
console.log(
  JSON.stringify(
    {
      simulated: true,
      networkCalls: 0,
      githubWrites: f.state.writes.length,
      vercelWrites: 0,
      baseline: { version: baseline.version, sha: baseline.sha },
      repeatedDryRunIdentical: true,
      proposedTag: { ref: `refs/tags/${result.version}`, commit: result.sha },
      planHash: result.planHash,
      notes: result.notes,
    },
    null,
    2
  )
)
