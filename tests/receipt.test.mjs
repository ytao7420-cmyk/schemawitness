import test from 'node:test';
import assert from 'node:assert/strict';
import {assertExecutionSucceeded, terminalStatus, summarizeReceipt} from '../lib/receipt.js';

function successful() {
  return {
    statusName: 'ACCEPTED', result_name: 'MAJORITY_AGREE', leader_only: false,
    consensus_data: {
      votes: {a: 'agree', b: 'agree', c: 'disagree'},
      leader_receipt: [{mode: 'leader', execution_result: 'SUCCESS', result: {status: 'return'}}],
    },
  };
}

test('majority execution success is usable without relabeling it unanimous or finalized', () => {
  const receipt = successful();
  assert.equal(assertExecutionSucceeded(receipt), receipt);
  const summary = summarizeReceipt(receipt);
  assert.equal(summary.status, 'ACCEPTED');
  assert.equal(summary.votes.c, 'disagree');
});

test('a finalized but rejected consensus result is not successful', () => {
  const receipt = successful();
  receipt.statusName = 'FINALIZED';
  receipt.result_name = 'MAJORITY_DISAGREE';
  assert.throws(() => assertExecutionSucceeded(receipt), /consensus/);
});

test('an accepted lifecycle without explicit consensus evidence is insufficient', () => {
  const receipt = successful();
  delete receipt.result_name;
  assert.throws(() => assertExecutionSucceeded(receipt), /consensus/);
});

test('majority agreement on a VM error cannot be called successful execution', () => {
  const receipt = successful();
  receipt.consensus_data.leader_receipt[0].genvm_result = {error_description: 'Source hash mismatch'};
  assert.throws(() => assertExecutionSucceeded(receipt), /execution/);
});

test('validator receipt order does not replace the actual leader result', () => {
  const receipt = successful();
  receipt.consensus_data.leader_receipt.push({mode: 'validator', execution_result: 'SUCCESS', result: {status: 'return'}});
  assert.doesNotThrow(() => assertExecutionSucceeded(receipt));
  receipt.consensus_data.leader_receipt[0].execution_result = 'ERROR';
  assert.throws(() => assertExecutionSucceeded(receipt), /execution/);
});

test('a later failed leader takes precedence over an earlier successful leader', () => {
  const receipt = successful();
  receipt.consensus_data.leader_receipt.push({mode: 'leader', execution_result: 'ERROR'});
  assert.throws(() => assertExecutionSucceeded(receipt), /execution/);
});

test('leader-only or unspecified validator mode cannot establish a full validator run', () => {
  for (const mode of [true, undefined]) {
    const receipt = successful();
    receipt.leader_only = mode;
    assert.throws(() => assertExecutionSucceeded(receipt), /full validator run/);
  }
});

test('numeric SDK states preserve execution and consensus separation', () => {
  const receipt = successful();
  delete receipt.statusName;
  delete receipt.result_name;
  receipt.status = 7;
  receipt.result = 6;
  assert.doesNotThrow(() => assertExecutionSucceeded(receipt));
  receipt.result = 7;
  assert.throws(() => assertExecutionSucceeded(receipt), /consensus/);
});

test('timeouts and undetermined results stop polling but are not success', () => {
  for (const state of ['UNDETERMINED', 'CANCELED', 'LEADER_TIMEOUT', 'VALIDATORS_TIMEOUT']) {
    const receipt = {...successful(), statusName: state};
    assert.equal(terminalStatus(receipt), true);
    assert.throws(() => assertExecutionSucceeded(receipt), /lifecycle/);
  }
  assert.equal(terminalStatus({statusName: 'PENDING'}), false);
});

test('a return-shaped success with an error status or no execution record is rejected', () => {
  const receipt = successful();
  receipt.consensus_data.leader_receipt[0].result.status = 'error';
  assert.throws(() => assertExecutionSucceeded(receipt), /execution/);
  receipt.consensus_data.leader_receipt = [];
  assert.throws(() => assertExecutionSucceeded(receipt), /execution/);
});
