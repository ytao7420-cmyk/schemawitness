import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadScheduler,retryAfterMs} from '../lib/read-scheduler.js';

test('reads are serialized and paced even when requested concurrently',async()=>{
  let time=0;const starts=[];
  const schedule=createReadScheduler({now:()=>time,sleep:async ms=>{time+=ms;}});
  const results=await Promise.all([1,2,3].map(n=>schedule(async()=>{starts.push(time);return n;})));
  assert.deepEqual(starts,[0,2200,4400]);assert.deepEqual(results,[1,2,3]);
});
test('server retry_after_seconds is honored with padding and bounded retries',async()=>{
  let time=0,calls=0;const starts=[];
  const schedule=createReadScheduler({maxAttempts:3,now:()=>time,sleep:async ms=>{time+=ms;}});
  const failure={code:-32029,data:{retry_after_seconds:4}};
  await assert.rejects(schedule(async()=>{calls++;starts.push(time);throw failure;}),error=>error===failure);
  assert.equal(calls,3);assert.deepEqual(starts,[0,4500,9000]);
});
test('a nested viem rate limit is detected; ordinary RPC failure is not retried',async()=>{
  assert.equal(retryAfterMs({cause:{code:-32029,data:{retry_after_seconds:4}}}),4000);
  assert.equal(retryAfterMs({message:'rate limit',cause:{code:-32029,data:{retry_after_seconds:20}}}),20000);
  let calls=0;
  const schedule=createReadScheduler();
  await assert.rejects(schedule(async()=>{calls++;throw new Error('Invalid calldata');}),/Invalid calldata/);
  assert.equal(calls,1);
});
test('rate limiting can recover without altering the operation result',async()=>{
  let time=0,calls=0;
  const schedule=createReadScheduler({now:()=>time,sleep:async ms=>{time+=ms;}});
  const result=await schedule(async()=>{if(calls++===0)throw{code:-32029,data:{retry_after_seconds:4}};return {status:'MISMATCH'};});
  assert.deepEqual(result,{status:'MISMATCH'});assert.equal(time,4500);assert.equal(calls,2);
});
