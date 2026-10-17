// Explicit, resumable zero-value Studionet workflow. Default is a plan only.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {ROOT,LOCAL,CHAIN_ID,RPC,EXPLORER,reader,readJson,readJsonContract,saveJson,acquireLock,testActor,Journal} from './runtime.mjs';
import {loadSource,sha256} from './capture-source.mjs';
import {canonical,verifyMapping,verifyNormalization,verifySampleReceipt,verifyArchive} from './verify-evidence.mjs';
import {summarizeReceipt} from '../lib/receipt.js';

const options=process.argv.slice(2);
const flag=name=>options.includes(name);
const option=name=>{
  const inline=options.find(arg=>arg.startsWith(name+'='));
  if(inline)return inline.slice(name.length+1);
  const index=options.indexOf(name);return index>=0?options[index+1]:undefined;
};
const deploying=flag('--deploy'),running=flag('--run');
const preset=await readJson(new URL('demo-preset.json',import.meta.url));
if(flag('--plan')||(!deploying&&!running)) {
  console.log(JSON.stringify({planOnly:true,network:'GenLayer Studionet',chainId:CHAIN_ID,value:'0',leaderOnly:false,deployCommand:'node scripts/live-test.mjs --deploy --source-sha=<reviewed-contract-sha256>',runCommand:'node scripts/live-test.mjs --run',sourceCommand:'npm run source',notice:preset.notice,plans:preset.plans.map(p=>({id:p.id,element:p.element,target:p.target,expectedAttestation:p.expectedAttestation,samples:p.samples.length})),successfulWorkflowWrites:11,expectedRejectionWrites:1},null,2));
  process.exit(0);
}

const source=await readFile(new URL('contracts/schemawitness.py',ROOT),'utf8');
const sourceSha256=sha256(source);
if(deploying)assert.equal(option('--source-sha'),sourceSha256,'Deployment requires the reviewed exact source SHA-256. No wallet or transaction was created.');
assert.ok(source.includes('class SchemaWitness(gl.Contract):'),'Unexpected contract source.');
const unlock=await acquireLock();
try {
  let config=await readJson(new URL('public/deployment.json',ROOT),null);
  if(deploying) {
    const deployer=await testActor('deployer');
    const journal=await Journal.load(new URL(`deployment-${sourceSha256}.json`,LOCAL),{chainId:CHAIN_ID,sourceSha256,deployer:deployer.account.address});
    const receipt=await journal.transact('deploy',{kind:'deploy',actor:deployer.account.address,sourceSha256,args:[],value:'0',leaderOnly:false},()=>deployer.deployContract({code:source,args:[],leaderOnly:false}));
    const address=receipt.data?.contract_address??receipt.txDataDecoded?.contractAddress??receipt.to_address;
    assert.match(address??'',/^0x[\da-f]{40}$/i,'Deployment receipt has no valid contract address.');
    const chainSource=await reader.getContractCode(address);
    assert.equal(sha256(chainSource),sourceSha256,'Deployed contract source differs from reviewed source.');
    // A reviewed source revision gets a new deployment journal and contract.
    // Preserve prior public deployment provenance; never reset/delete its history.
    const historyPath=new URL('public/evidence/deployments.json',ROOT);
    const history=await readJson(historyPath,{notice:'Historical test deployments. Deployment success does not establish a successful application workflow.',deployments:[]});
    const retain=entry=>{
      if(!entry?.deployed||history.deployments.some(item=>item.address.toLowerCase()===entry.address.toLowerCase()))return;
      history.deployments.push({address:entry.address,sourceSha256:entry.sourceSha256,deploymentTransaction:entry.deploymentTransaction,chainId:entry.chainId,verifiedAt:entry.verifiedAt,status:entry.deploymentReceipt?.status??'UNKNOWN',consensusResult:entry.deploymentReceipt?.consensusResult??'UNKNOWN',execution:entry.deploymentReceipt?.execution??'UNKNOWN',leaderOnly:entry.deploymentReceipt?.leaderOnly??null});
    };
    retain(config);
    config={network:'GenLayer Studionet',chainId:CHAIN_ID,rpc:RPC,explorer:EXPLORER,deployed:true,address,sourceSha256,deployer:deployer.account.address,deploymentTransaction:journal.state.transactions[0].hash,deploymentReceipt:summarizeReceipt(receipt),notice:'Self-controlled auxiliary test deployer. Test network only, no production funds or Portal-user attribution.',verifiedAt:new Date().toISOString()};
    retain(config);await saveJson(historyPath,history);
    await saveJson(new URL('public/deployment.json',ROOT),config);
    console.log(JSON.stringify({deployed:true,address,sourceSha256,hash:config.deploymentTransaction}));
  }
  if(running) {
    assert.ok(config?.deployed,'Deploy a reviewed contract first.');
    assert.equal(config.chainId,CHAIN_ID);assert.equal(config.rpc,RPC);
    assert.match(config.address,/^0x[\da-f]{40}$/i);
    assert.equal(config.sourceSha256,sourceSha256,'Local contract changed since deployment; review and deploy it explicitly first.');
    assert.equal(sha256(await reader.getContractCode(config.address)),sourceSha256,'On-chain contract source differs.');
    const official=await loadSource();
    const creator=await testActor('creator'),recorder=await testActor('recorder');
    assert.notEqual(creator.account.address.toLowerCase(),recorder.account.address.toLowerCase());
    const identity={chainId:CHAIN_ID,address:config.address.toLowerCase(),sourceSha256,dictionarySha256:official.sha256,presetDigest:sha256(canonical(preset)),creator:creator.account.address,recorder:recorder.account.address};
    const journal=await Journal.load(new URL(`workflow-${config.address.toLowerCase()}.json`,LOCAL),identity);
    const negativeJournal=await Journal.load(new URL(`negative-workflow-${config.address.toLowerCase()}.json`,LOCAL),{...identity,purpose:'expected semantic mismatch rejection'});
    const read=(method,args=[])=>readJsonContract(config.address,method,args);
    const send=async(label,actor,method,args)=>journal.transact(label,{kind:'call',address:config.address,actor:actor.account.address,method,args,value:'0',leaderOnly:false},()=>actor.writeContract({address:config.address,functionName:method,args,value:0n,leaderOnly:false}),{recoverLabel:option('--recover-label'),recoverHash:option('--recover-hash')});
    const mappings=[];
    for(const fixture of preset.plans) {
      const id=fixture.id,owner=creator.account.address;
      await send(`${id}-create`,creator,'create_plan',[id,fixture.element,fixture.target.quantity,fixture.target.aggregation,fixture.target.unit,official.sha256]);
      let plan=await read('get_plan',[owner,id]);
      assert.equal(plan.owner.toLowerCase(),owner.toLowerCase());
      assert.equal(plan.dictionary_sha256,official.sha256);
      await send(`${id}-capture`,creator,'capture_dictionary',[id]);
      const dictionary=await read('get_dictionary',[owner,id]);
      assert.equal(dictionary.text,official.text,'Validators did not capture the exact expected NOAA dictionary.');
      await send(`${id}-attest`,creator,'attest',[id]);
      const attestation=await read('get_attestation',[owner,id]);
      const mapping={plan,dictionary,attestation,receipt:null};
      verifyMapping(mapping,fixture,official);
      if(fixture.expectedAttestation==='ACCEPTED') {
        // The observed Studio gen_call endpoint rejects canonical RLP wrappers
        // above 255 bytes. Each sample is independent under an immutable mapping,
        // so preview one row per read and compare all rows with the batch receipt.
        // Full record_samples writes remain a single batch transaction.
        mapping.preview=[];
        for(const sample of fixture.samples) {
          const row=await read('normalize_samples',[owner,id,JSON.stringify([sample])]);
          assert.equal(row.length,1,'Single-sample preview returned an unexpected count.');
          mapping.preview.push(row[0]);
        }
        mapping.previewReadStrategy='One sample per read due to observed Studionet gen_call long-RLP failure; full batch recorded in one transaction and compared row-for-row.';
        verifyNormalization(mapping.preview,fixture);
        await send(`${id}-record`,recorder,'record_samples',[owner,id,fixture.receiptId,JSON.stringify(fixture.samples)]);
        mapping.receipt=await read('get_receipt',[recorder.account.address,fixture.receiptId]);
        verifySampleReceipt(mapping.receipt,mapping,fixture,recorder.account.address);
        assert.deepEqual(mapping.preview,mapping.receipt.results,'View and recorded deterministic results differ.');
      } else {
        let rejection;
        try {await read('normalize_samples',[owner,id,JSON.stringify(fixture.samples)]);}
        catch(error) {rejection=error;}
        assert.ok(rejection,'A semantic mismatch was allowed to normalize samples.');
        // Studio may hide the rollback behind a generic gen_call error. Keep
        // that error as diagnostic only and prove rejection with a distinct
        // zero-value write whose decoded rollback and absent state are verified.
        mapping.normalizationError=String(rejection.message).slice(0,800);
        mapping.normalizationErrorNotice='Generic read error is not rejection evidence; see the separately recorded expected-rollback write.';
        const receiptId=`negative-${id}`;
        const args=[owner,id,receiptId,JSON.stringify(fixture.samples)];
        const label=`${id}-expected-rejection`;
        await negativeJournal.transactExpectedRollback(label,{kind:'call',address:config.address,actor:recorder.account.address,method:'record_samples',args,value:'0',leaderOnly:false},()=>recorder.writeContract({address:config.address,functionName:'record_samples',args,value:0n,leaderOnly:false}),'Normalization requires an accepted semantic mapping',{recoverLabel:option('--recover-label'),recoverHash:option('--recover-hash')});
        const attemptedReceipt=await read('get_receipt',[recorder.account.address,receiptId]);
        assert.equal(attemptedReceipt,null,'Rejected mapping unexpectedly committed a sample receipt.');
        mapping.normalizationBlocked=true;
        mapping.negativeReceiptId=receiptId;
        mapping.negativeReceiptReadBack=attemptedReceipt;
        mapping.negativeTransactionHash=negativeJournal.state.transactions.find(tx=>tx.label===label).hash;
      }
      const unchanged=await read('get_attestation',[owner,id]);
      assert.deepEqual(unchanged,attestation,'Attestation mutated during normalization.');
      mappings.push(mapping);
      console.log(JSON.stringify({plan:id,status:attestation.status,samples:fixture.samples.length,recorded:!!mapping.receipt}));
    }
    await journal.refresh();
    const archive={recordedAt:new Date().toISOString(),network:config.network,chainId:CHAIN_ID,explorer:EXPLORER,contractAddress:config.address,contractSourceSha256:sourceSha256,presetDigest:identity.presetDigest,notice:preset.notice,actors:{creator:creator.account.address,recorder:recorder.account.address},source:{url:official.url,sha256:official.sha256,bytes:official.bytes,retrievedAt:official.retrievedAt},verification:{contractSourceVerified:true,originalDictionaryBytesVerified:true,digestsVerified:true,citationsVerified:true,exactConversionsVerified:true,flagAndMissingHandlingVerified:true,semanticMismatchBlocked:true},mappings,transactions:journal.state.transactions,negativeTransactions:negativeJournal.state.transactions};
    const result=verifyArchive(archive,preset,official);
    await saveJson(new URL('public/evidence/demo.json',ROOT),archive);
    console.log(JSON.stringify({complete:true,...result,output:'public/evidence/demo.json'}));
  }
} finally {await unlock();}
