// Inspect by default. --apply-hold is a remote configuration mutation requiring approval.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function productionGate({ token, apply = false, fetcher = fetch }) {
  if (!token) throw Error('VERCEL_TOKEN_REQUIRED')
  const call = async (path, method = 'GET', body) => {
    const response = await fetcher('https://api.vercel.com'+path, {
      method, headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}), redirect:'error', signal:AbortSignal.timeout(15000),
    })
    if (!response.ok) throw Error('VERCEL_'+method+'_HTTP_'+response.status)
    return response.json()
  }
  const {teams}=await call('/v2/teams')
  const team=teams.find(t=>t.slug==='danielalvesliras-projects')
  if (!team) throw Error('EXPECTED_VERCEL_TEAM_NOT_ACCESSIBLE')
  const path='/v9/projects/prj_WYVlCGYu021KZCrqfp62qRH2cbIE?teamId='+encodeURIComponent(team.id)
  const check=p=>{
    if(p.id!=='prj_WYVlCGYu021KZCrqfp62qRH2cbIE'||p.name!=='treinos_academia'||p.accountId!==team.id||p.link?.type!=='github'||p.link?.org!=='Danielalveslira'||p.link?.repo!=='treinos_academia'||p.link?.productionBranch!=='main') throw Error('VERCEL_TARGET_MISMATCH')
  }
  const before=await call(path);check(before)
  let after=before
  if(apply && before.autoAssignCustomDomains!==false){
    await call(path,'PATCH',{autoAssignCustomDomains:false})
    after=await call(path);check(after)
  }
  if(apply && after.autoAssignCustomDomains!==false)throw Error('VERCEL_HOLD_NOT_CONFIRMED')
  if(apply && before.targets?.production?.id!==after.targets?.production?.id)throw Error('PRODUCTION_CHANGED_DURING_HOLD_CHECK')
  return {team:team.slug,project:before.name,productionBranch:before.link.productionBranch,previousAutoAssign:before.autoAssignCustomDomains,autoAssignCustomDomains:after.autoAssignCustomDomains,productionDeploymentId:after.targets?.production?.id??null,applied:apply&&before.autoAssignCustomDomains!==false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.slice(2).some(a=>a!=='--apply-hold'))throw Error('Only --apply-hold is accepted')
  console.log(JSON.stringify(await productionGate({token:process.env.VERCEL_TOKEN,apply:process.argv.includes('--apply-hold')}),null,2))
}
