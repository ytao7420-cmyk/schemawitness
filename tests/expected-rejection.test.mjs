import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertExpectedRollback} from '../lib/receipt.js';
import {verifyNegativeTransaction} from '../scripts/verify-evidence.mjs';

const message='Normalization requires an accepted semantic mapping';
const address='0x'+'1'.repeat(40),actor='0x'+'2'.repeat(40),other='0x'+'3'.repeat(40);
const receipt=()=>({statusName:'FINALIZED',result_name:'MAJORITY_AGREE',leader_only:false,consensus_data:{leader_receipt:[{mode:'leader',execution_result:'ERROR',result:{status:'rollback',payload:message}}]}});
const archive={contractAddress:address,actors:{recorder:actor}};
const negative=()=>({hash:'0x'+'a'.repeat(64),status:'ACCEPTED',consensusResult:'MAJORITY_AGREE',execution:'ERROR',executionResult:'ERROR',leaderOnly:false,spec:{kind:'call',address,actor,value:'0',expectedRollback:message},expectedFailure:true,expectedRollbackVerified:true,leaderResultStatus:'rollback',decodedRollback:message,outcome:'EXPECTED_REJECTION'});

test('validator-agreed rollback is verified without calling execution a success',()=>{
  const observed=receipt();assert.equal(assertExpectedRollback(observed,message),observed);
  observed.statusName='ACCEPTED';assertExpectedRollback(observed,message);
  verifyNegativeTransaction(negative(),archive);
});
test('a matching rollback with majority disagreement is not rejection proof',()=>{
  const observed=receipt();observed.result_name='MAJORITY_DISAGREE';
  assert.throws(()=>assertExpectedRollback(observed,message),/majority agreement/);
  assert.throws(()=>verifyNegativeTransaction({...negative(),consensusResult:'MAJORITY_DISAGREE'},archive),/agreed by validators/);
});
test('undetermined and canceled lifecycle cannot establish expected rejection',()=>{
  for(const status of ['UNDETERMINED','CANCELED','LEADER_TIMEOUT']){
    const observed=receipt();observed.statusName=status;
    assert.throws(()=>assertExpectedRollback(observed,message),/accepted consensus outcome/);
    assert.throws(()=>verifyNegativeTransaction({...negative(),status},archive),/accepted lifecycle/);
  }
});
test('an absent consensus result or leader-only run is insufficient',()=>{
  const observed=receipt();delete observed.result_name;
  assert.throws(()=>assertExpectedRollback(observed,message),/majority agreement/);
  const leaderOnly=receipt();leaderOnly.leader_only=true;
  assert.throws(()=>assertExpectedRollback(leaderOnly,message),/full validator/);
});
test('wrong rollback reason and validator-only error are rejected',()=>{
  assert.throws(()=>assertExpectedRollback(receipt(),'Wrong reason'),/not established/);
  const observed=receipt();observed.consensus_data.leader_receipt[0].mode='validator';
  assert.throws(()=>assertExpectedRollback(observed,message),/explicit leader/);
});
test('negative evidence must target this contract, actor and call type',()=>{
  for(const [field,value,pattern] of [['address',other,/another contract/],['actor',other,/differs from recorder/],['kind','deploy',/contract call/]]){
    const evidence=negative();evidence.spec[field]=value;
    assert.throws(()=>verifyNegativeTransaction(evidence,archive),pattern);
  }
});
test('negative evidence cannot be rewritten as successful execution',()=>{
  assert.throws(()=>verifyNegativeTransaction({...negative(),execution:'SUCCESS'},archive));
  const observed=receipt();observed.consensus_data.leader_receipt[0]={mode:'leader',execution_result:'SUCCESS',result:{status:'return'}};
  assert.throws(()=>assertExpectedRollback(observed,message),/not established/);
});
