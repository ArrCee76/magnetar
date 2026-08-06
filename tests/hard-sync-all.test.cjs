const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const chromeBackground = fs.readFileSync(path.join(root, 'chrome', 'background.js'), 'utf8');
const firefoxBackground = fs.readFileSync(path.join(root, 'firefox', 'background.js'), 'utf8');
const chromeContent = fs.readFileSync(path.join(root, 'chrome', 'content.js'), 'utf8');
const firefoxContent = fs.readFileSync(path.join(root, 'firefox', 'content.js'), 'utf8');
const chromeManifest = JSON.parse(fs.readFileSync(path.join(root, 'chrome', 'manifest.json'), 'utf8'));
const firefoxManifest = JSON.parse(fs.readFileSync(path.join(root, 'firefox', 'manifest.json'), 'utf8'));
function extract(source, name) { const marker = `async function ${name}`; const start=source.indexOf(marker); assert.notEqual(start,-1,`missing ${name}`); const brace=source.indexOf(') {',start)+2; let depth=0,quote='',escaped=false; for(let i=brace;i<source.length;i++){const c=source[i];if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue}if(c==='"'||c==="'"||c==='`'){quote=c;continue}if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(start,i+1)}throw Error('unclosed '+name); }
assert.equal(chromeBackground, firefoxBackground, 'Chrome/Firefox hard-sync coordinator parity');
assert.equal(chromeContent, firefoxContent, 'Chrome/Firefox hard-sync UI parity');
assert.match(chromeContent, /MAGNETAR_HARD_SYNC_ALL/);
assert.match(chromeContent, /type: 'hard-sync-all'/);
assert.match(chromeContent, /magnetar:hard-sync-all-progress/);
assert.match(chromeContent, /#magnetar-mobile-sync-open'[\s\S]{0,180}openMobileSyncPanel/);
assert.doesNotMatch(chromeContent, /#magnetar-mobile-sync-open'[\s\S]{0,180}runHardSyncAllFromExtension/);
assert.doesNotMatch(chromeContent.slice(chromeContent.indexOf('function updateHardSyncUi'), chromeContent.indexOf('function publishHardSyncWebResult')), /magnetar-mobile-sync-open/);
assert.ok(chromeManifest.permissions.includes('alarms'));
assert.ok(firefoxManifest.permissions.includes('alarms'));
assert.match(chromeBackground, /HARMONY_SYNC_PERIOD_MINUTES = 1/);
assert.match(chromeBackground, /runAutomaticHarmonySync\('periodic-alarm'\)/);
assert.match(chromeBackground, /scheduleAutomaticHarmonySync\('canonical-storage-change'\)/);
assert.match(chromeBackground, /return hardSyncAll\(\{ cycleId:/, 'automatic harmony must use the full coordinator');

async function scenario({ hostedFailure=false } = {}) {
  const calls=[];
  const state={'magnetar-saved':[],'magnetar-history':[],'magnetar-organised-folders':{folders:[],deletedFolders:[]}};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const storage={async get(keys){return Object.fromEntries(keys.filter(key=>key in state).map(key=>[key,clone(state[key])]))},async set(values){calls.push('commit');Object.assign(state,clone(values))}};
  const stable=value=>JSON.stringify(value,Object.keys(value||{}).sort());
  const context={console:{info(){},debug(){}},Date,Promise,Object,Array,Set,Map,Number,String,Error,JSON,
    SYNC_COORDINATOR_CHECKPOINT_KEY:'magnetar-sync-coordinator-checkpoint',MAGNETAR_API:{storage:{local:storage}},
    getSelfHostedConnection:async()=>({token:'redacted',cursor:0}),MagnetarSyncStorage:{loadSettings:async()=>({enabled:true,syncId:'id',syncToken:'redacted',encryptionKey:'redacted'})},
    selfHostedRequest:async()=>{calls.push('pull-self');return{cursor:1,snapshot:{saved:[{stableKey:'hash:self',hash:'self',displayName:'Self',updatedAt:20}],folders:[],history:[],tombstones:{saved:[],folders:[],assignments:[]}}}},
    runSelfHostedExclusive:async()=>{calls.push('push-self');return{ok:true,cursor:1,mutationCount:1,changed:true}},
    MagnetarSyncData:{inspectHostedReplica:async()=>{calls.push('pull-hosted');if(hostedFailure)throw new Error('offline');return{revision:2,state:{saved:[{stableKey:'hash:mobile',hash:'mobile',name:'Mobile',updatedAt:30}],history:[],folders:{folders:[],deletedFolders:[]}}}},synchroniseHostedCanonical:async options=>{calls.push('push-hosted');calls.push({hostedOptions:options});return{ok:true,revision:3,mutationCount:1,changed:true}}},
    MagnetarSelfHostedSync:{stableStringify:stable,stableKey:item=>item.stableKey||`hash:${item.hash}`,normaliseServer:snapshot=>snapshot,projectCanonical:(canonical,history)=>({saved:(canonical.saved||[]).map(item=>({stableKey:item.stableKey,hash:item.hash,name:item.displayName,updatedAt:item.updatedAt})),history,folders:{folders:[],deletedFolders:[]}}),reconcileReplicas:({local,remotes})=>({canonical:{saved:{},folders:{},assignments:{}},sources:{},local:{saved:[...local.saved,...remotes.flatMap(remote=>remote.state.saved)],history:local.history,folders:local.folders}}),canonicaliseReplica:data=>({saved:Object.fromEntries((data.saved||[]).map(item=>[item.stableKey||`hash:${item.hash}`,item])),folders:{},assignments:{}})},
    publishHardSyncProgress:async(_id,stage)=>calls.push('progress:'+stage)};
  context.globalThis=context;vm.createContext(context);const start=chromeBackground.indexOf('async function loadCoordinatorLocalState');const end=chromeBackground.indexOf('async function hardSyncAll');vm.runInContext(chromeBackground.slice(start,end)+';globalThis.run=executeHardSyncAll;',context);
  try{return{result:await context.run({cycleId:'cycle'}),calls,state}}catch(error){return{error,calls,state}}
}
(async()=>{
  const threeWay=await scenario();assert.equal(threeWay.result.passes,1);assert.deepEqual(threeWay.state['magnetar-saved'].map(item=>item.hash),['self','mobile']);
  const hostedPush = threeWay.calls.find(value => value?.hostedOptions); assert.equal(hostedPush.hostedOptions.expectedRevision, 2); assert.ok(hostedPush.hostedOptions.canonical, 'Hosted push must receive the coordinator canonical map instead of re-merging a projection');
  assert.ok(threeWay.calls.indexOf('pull-self')<threeWay.calls.indexOf('commit'));assert.ok(threeWay.calls.indexOf('pull-hosted')<threeWay.calls.indexOf('commit'));assert.ok(threeWay.calls.indexOf('commit')<threeWay.calls.indexOf('push-self'));assert.ok(threeWay.calls.indexOf('push-self')<threeWay.calls.indexOf('push-hosted'));
  const partial=await scenario({hostedFailure:true});assert.equal(partial.error.code,'HARD_SYNC_PARTIAL_FAILURE');assert.equal(partial.error.adapters.selfHosted.ok,true);assert.equal(partial.error.adapters.hosted.ok,false);assert.ok(partial.state['magnetar-saved'].some(item=>item.hash==='self'),'successful remote survives a peer failure');
  const context={hardSyncAllInFlight:null,calls:0,runCanonicalExclusive:task=>task(),executeHardSyncAll:()=>{context.calls++;return new Promise(r=>setTimeout(()=>r({ok:true}),5))}};vm.createContext(context);vm.runInContext(extract(chromeBackground,'hardSyncAll')+';globalThis.run=hardSyncAll;',context);const first=context.run({cycleId:'a'}),second=context.run({cycleId:'b'});await Promise.all([first,second]);assert.equal(context.calls,1);
  console.log('Hard-sync-all coordinator checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
