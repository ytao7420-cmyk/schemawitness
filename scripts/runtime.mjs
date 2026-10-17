import {createClient, createAccount, generatePrivateKey, abi} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {readFile, writeFile, mkdir, chmod, rename, unlink, open} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {assertExecutionSucceeded, assertExpectedRollback, terminalStatus, summarizeReceipt} from '../lib/receipt.js';
import {createReadScheduler} from '../lib/read-scheduler.js';

export const ROOT = new URL('../',import.meta.url);
export const LOCAL = new URL('.local/',ROOT);
export const CHAIN_ID=61999;
export const RPC='https://studio.genlayer.com/api';
export const EXPLORER='https://explorer-studio.genlayer.com';
assert.equal(studionet.id,CHAIN_ID,'This harness only supports GenLayer Studionet.');
assert.equal(studionet.rpcUrls.default.http[0],RPC,'Pinned SDK Studionet RPC changed.');
const rawReader=createClient({chain:studionet});
const scheduleRead=createReadScheduler({onRetry:event=>console.log(JSON.stringify({readRetry:event.label,attempt:event.attempt,retryAfterSeconds:event.retryAfterMs/1000}))});
const pacedMethods=new Set(['readContract','getTransaction','getContractCode','getContractSchema']);
const wrappedMethods=new Map();
export const reader=new Proxy(rawReader,{get(target,property,receiver){
  const value=Reflect.get(target,property,receiver);
  if(!pacedMethods.has(property)||typeof value!=='function')return value;
  if(!wrappedMethods.has(property))wrappedMethods.set(property,(...args)=>scheduleRead(()=>Reflect.apply(value,target,args),property));
  return wrappedMethods.get(property);
}});

export async function readJsonContract(address,method,args=[]) {
  try {return JSON.parse(await reader.readContract({address,functionName:method,args}));}
  catch(error) {throw new Error(`Read ${method} on ${address} failed: ${error.message}`,{cause:error});}
}

export async function readJson(path,fallback) {
  try {return JSON.parse(await readFile(path,'utf8'));}
  catch(error) {if(error.code==='ENOENT'&&arguments.length>1)return fallback;throw error;}
}

export async function saveJson(path,value) {
  const temp=new URL(`${path.href}.tmp-${process.pid}`);
  await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(temp,path);
}

export async function acquireLock() {
  await mkdir(LOCAL,{recursive:true,mode:0o700});
  await chmod(LOCAL,0o700);
  const path=new URL('run.lock',LOCAL);
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const handle=await open(path,'wx',0o600);
      await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
      await handle.close();
      return ()=>unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
    } catch(error) {
      if(error.code!=='EEXIST')throw error;
      const previous=await readJson(path);
      assert.ok(Number.isSafeInteger(previous.pid)&&previous.pid>0,'Unknown lock owner; inspect .local/run.lock.');
      try {process.kill(previous.pid,0);}
      catch(probe) {if(probe.code==='ESRCH'){await unlink(path);continue;}throw probe;}
      throw new Error(`Another harness process (${previous.pid}) is active. No transaction sent by this process.`);
    }
  }
  throw new Error('Could not obtain run lock.');
}

export async function testActor(name) {
  assert.match(name,/^[a-z-]+$/);
  const path=new URL(`${name}-test-wallet.json`,LOCAL);
  let record=await readJson(path,null);
  if(!record) {
    record={privateKey:generatePrivateKey()};
    await writeFile(path,JSON.stringify(record),{flag:'wx',mode:0o600});
  }
  await chmod(path,0o600);
  return createClient({chain:studionet,account:createAccount(record.privateKey)});
}

export async function waitReceipt(hash,{attempts=120,pollMs=4000}={}) {
  assert.match(hash,/^0x[\da-f]{64}$/i);
  for(let n=0;n<attempts;n++) {
    let receipt;
    try {receipt=await reader.getTransaction({hash});}
    catch(error) {if(n===attempts-1)throw new Error(`Could not read ${hash}; transaction remains recorded for recovery.`,{cause:error});}
    if(receipt&&terminalStatus(receipt)) {
      try {return assertExecutionSucceeded(receipt);}
      catch(error) {
        await saveJson(new URL(`failed-receipt-${hash}.json`,LOCAL),receipt);
        Object.defineProperty(error,'receipt',{value:receipt});
        throw error;
      }
    }
    if(n%8===0)console.log(JSON.stringify({hash,status:receipt?.statusName??receipt?.status??'RPC_UNAVAILABLE'}));
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  throw new Error(`Pending ${hash}. Rerun with the same flags to resume; do not resubmit manually.`);
}

export class Journal {
  constructor(path,state) {this.path=path;this.state=state;}
  static async load(path,identity) {
    const state=await readJson(path,{identity,transactions:[]});
    assert.deepEqual(state.identity,identity,'Journal does not match this contract, source, network or actors.');
    return new Journal(path,state);
  }
  save() {return saveJson(this.path,this.state);}
  async transact(label,spec,send,{recoverLabel,recoverHash}={}) {
    let item=this.state.transactions.find(tx=>tx.label===label);
    if(item) {
      assert.deepEqual(item.spec,spec,'Resume transaction differs from the previously recorded intention.');
      if(!item.hash) {
        if(recoverLabel!==label||!/^0x[\da-f]{64}$/i.test(recoverHash??'')) {
          throw new Error(`Uncertain broadcast for ${label}. Inspect the public actor history. Attach an identified transaction with --recover-label=${label} --recover-hash=0x...; no automatic resubmission.`);
        }
        const recovered=await reader.getTransaction({hash:recoverHash});
        const recoveredActor=recovered.from_address??recovered.from??recovered.txDataDecoded?.sender;
        assert.equal(String(recoveredActor).toLowerCase(),spec.actor.toLowerCase(),'Recovered transaction actor differs.');
        assert.equal(spec.kind,'call','Deployment recovery requires manual source and receipt inspection before attaching a hash to its journal.');
        assert.equal(String(recovered.to_address??recovered.to).toLowerCase(),spec.address.toLowerCase(),'Recovered transaction contract differs.');
        const calldata=recovered.data?.calldata?.raw;
        assert.ok(Array.isArray(calldata),'Recovered transaction has no verifiable calldata.');
        assert.deepEqual(Uint8Array.from(calldata),abi.calldata.encode(abi.calldata.makeCalldataObject(spec.method,spec.args,undefined)),'Recovered transaction calldata differs.');
        assert.equal(recovered.leader_only,false,'Recovered transaction was not a full validator run.');
        item.hash=recoverHash;item.recoveredAt=new Date().toISOString();await this.save();
      }
    } else {
      item={label,spec,intendedAt:new Date().toISOString(),status:'BROADCAST_INTENT',execution:'UNCONFIRMED'};
      this.state.transactions.push(item);
      await this.save(); // Save intention before touching the network.
      item.hash=await send();
      assert.match(item.hash,/^0x[\da-f]{64}$/i,'SDK returned no transaction hash.');
      item.submittedAt=new Date().toISOString();item.status='PENDING';
      await this.save(); // Save hash before waiting, making waits resumable.
    }
    console.log(JSON.stringify({label,hash:item.hash}));
    let receipt;
    try {receipt=await waitReceipt(item.hash);}
    catch(error) {
      if(error.receipt)Object.assign(item,summarizeReceipt(error.receipt),{failure:error.message});
      await this.save();throw error;
    }
    Object.assign(item,summarizeReceipt(receipt));await this.save();return receipt;
  }
  async refresh() {
    for(const item of this.state.transactions) {
      assert.ok(item.hash,'Incomplete transaction intention exists.');
      const receipt=await reader.getTransaction({hash:item.hash});
      assertExecutionSucceeded(receipt);Object.assign(item,summarizeReceipt(receipt));
    }
    await this.save();
  }
  async transactExpectedRollback(label,spec,send,expectedPayload,options={}) {
    // This is used only with a separate negative-test journal. A failed execution
    // remains ERROR; its expected rejection is not a successful transaction.
    let receipt;
    try {receipt=await this.transact(label,{...spec,expectedRollback:expectedPayload},send,options);}
    catch(error) {if(!error.receipt)throw error;receipt=error.receipt;}
    assertExpectedRollback(receipt,expectedPayload);
    const item=this.state.transactions.find(tx=>tx.label===label);
    Object.assign(item,summarizeReceipt(receipt),{
      execution:'ERROR',
      expectedFailure:true,
      expectedRollbackVerified:true,
      decodedRollback:expectedPayload,
      leaderResultStatus:'rollback',
      outcome:'EXPECTED_REJECTION'
    });
    delete item.failure;
    await this.save();
    return receipt;
  }
}
