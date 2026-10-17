// Read-only, deliberately restricted diagnostic export. Never copies node configs,
// raw consensus execution logs, local wallets or signatures into public evidence.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reader,ROOT,LOCAL,readJson,saveJson,CHAIN_ID,EXPLORER} from './runtime.mjs';
import {lifecycleStatus,consensusResult,executionEvidence} from '../lib/receipt.js';
import {sha256} from './capture-source.mjs';

const flags=Object.fromEntries(process.argv.slice(2).map(arg=>{const index=arg.indexOf('=');return [arg.slice(0,index),arg.slice(index+1)];}));
const address=flags['--address'],hash=flags['--hash'],sourceSha256=flags['--source-sha'];
assert.match(address??'',/^0x[\da-f]{40}$/i);
assert.match(hash??'',/^0x[\da-f]{64}$/i);
assert.match(sourceSha256??'',/^[\da-f]{64}$/);
const file=flags['--output']??'first-attempt.json';
assert.match(file,/^[a-z0-9-]+\.json$/,'Output must be a plain JSON filename in public/evidence.');
const local=await readJson(new URL(`failed-receipt-${hash}.json`,LOCAL));
assert.equal(String(local.to_address).toLowerCase(),address.toLowerCase());
const actor=local.from_address;
assert.match(actor,/^0x[\da-f]{40}$/i);
const journal=await readJson(new URL(`workflow-${address.toLowerCase()}.json`,LOCAL));
const item=journal.transactions.find(tx=>tx.hash===hash);
assert.ok(item,'Failed transaction must be present in its workflow journal.');
assert.equal(item.spec.method,'attest','This diagnostic exporter is limited to an attestation attempt.');
const planId=item.spec.args[0];
assert.equal(journal.identity.sourceSha256,sourceSha256);
assert.equal(sha256(await reader.getContractCode(address)),sourceSha256,'Historical on-chain source differs from journal.');
const current=await reader.getTransaction({hash});
const read=async name=>JSON.parse(await reader.readContract({address,functionName:name,args:[actor,planId]}));
const [plan,dictionary,attestation]=await Promise.all([read('get_plan'),read('get_dictionary'),read('get_attestation')]);
const summarize=receipt=>{
  const entries=receipt.consensus_data?.leader_receipt??[];
  const leaders=(Array.isArray(entries)?entries:[entries]).filter(entry=>entry?.mode==='leader');
  const leader=leaders.at(-1);
  const voteCounts={};
  for(const vote of Object.values(receipt.consensus_data?.votes??{}))voteCounts[vote]=(voteCounts[vote]??0)+1;
  const payload=leader?.result?.payload;
  return {lifecycle:lifecycleStatus(receipt),consensusResult:consensusResult(receipt),leaderOnly:receipt.leader_only??null,execution:executionEvidence(receipt).result,executionSuccessful:executionEvidence(receipt).success,leaderResultStatus:leader?.result?.status??null,decodedLeaderPayload:typeof payload==='string'?payload.slice(0,500):null,voteCounts};
};
assert.equal(attestation,null,'An attestation now exists; do not export a failed-state claim without investigation.');
const summary={recordedAt:new Date().toISOString(),network:'GenLayer Studionet',chainId:CHAIN_ID,contractAddress:address,contractSourceSha256:sourceSha256,transactionHash:hash,transactionUrl:`${EXPLORER}/tx/${hash}`,method:'attest',planId,initialObserved:summarize(local),currentObserved:summarize(current),stateReadBack:{planExists:!!plan,dictionaryCaptured:!!dictionary,dictionarySha256:dictionary?.sha256??null,attestation:null},outcome:'NO_ATTESTATION_COMMITTED',notice:'Historical unsuccessful first version, preserved for transparency. Lifecycle FINALIZED, if observed later, does not override failed VM execution or majority disagreement. The plan and dictionary existed, but this transaction did not establish an accepted semantic mapping. Current and local observations are distinct.'};
await saveJson(new URL(`public/evidence/${file}`,ROOT),summary);
console.log(JSON.stringify(summary,null,2));
