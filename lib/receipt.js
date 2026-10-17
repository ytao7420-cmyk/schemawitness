// Lifecycle, validator agreement and VM execution are different observations.
// Enum values are from the pinned genlayer-js 1.1.8 SDK.
const STATUSES = {5:'ACCEPTED',6:'UNDETERMINED',7:'FINALIZED',8:'CANCELED',12:'VALIDATORS_TIMEOUT',13:'LEADER_TIMEOUT'};
const RESULTS = {0:'IDLE',1:'AGREE',2:'DISAGREE',3:'TIMEOUT',4:'DETERMINISTIC_VIOLATION',5:'NO_MAJORITY',6:'MAJORITY_AGREE',7:'MAJORITY_DISAGREE'};

export function lifecycleStatus(receipt) {
  const value = receipt?.statusName ?? receipt?.status_name ?? receipt?.status;
  return STATUSES[value] ?? String(value ?? 'UNKNOWN').toUpperCase();
}

export function consensusResult(receipt) {
  const value = receipt?.result_name ?? receipt?.resultName ?? receipt?.result;
  return RESULTS[value] ?? String(value ?? 'UNKNOWN').toUpperCase();
}

export function executionEvidence(receipt) {
  const leaders = receipt?.consensus_data?.leader_receipt;
  const entries = Array.isArray(leaders) ? leaders : leaders ? [leaders] : [];
  const identified = entries.filter(entry => entry?.mode === 'leader');
  const leader = identified.at(-1) ?? (entries.every(entry => !entry?.mode) ? entries.at(-1) : undefined);
  const result = leader?.execution_result ?? (entries.length ? undefined : receipt?.txExecutionResultName);
  const hasError = [leader?.error, leader?.genvm_result?.raw_error, leader?.genvm_result?.error_code, leader?.genvm_result?.error_description]
    .some(value => value !== undefined && value !== null && value !== '');
  const returned = leader ? result === 'SUCCESS' : result === 'FINISHED_WITH_RETURN';
  const success = returned && !hasError && (leader?.result?.status === undefined || leader.result.status === 'return');
  return {result: result ?? 'UNKNOWN', success, hasError, leaderMode: leader?.mode ?? null};
}

export function terminalStatus(receipt) {
  return ['ACCEPTED','FINALIZED','UNDETERMINED','CANCELED','CANCELLED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT','APPEAL_UNDETERMINED'].includes(lifecycleStatus(receipt));
}

export function assertExecutionSucceeded(receipt) {
  const lifecycle = lifecycleStatus(receipt);
  if (!['ACCEPTED','FINALIZED'].includes(lifecycle)) throw new Error(`Transaction lifecycle is ${lifecycle}; no committed success established.`);
  const consensus = consensusResult(receipt);
  if (consensus !== 'MAJORITY_AGREE') throw new Error(`Validator consensus did not explicitly accept this transaction (${consensus}).`);
  const execution = executionEvidence(receipt);
  if (!execution.success) throw new Error(`Contract execution was not successful (${execution.result}).`);
  if (receipt.leader_only !== false) throw new Error('Receipt does not establish a full validator run (leader_only must be false).');
  return receipt;
}

export function summarizeReceipt(receipt) {
  return {
    status: lifecycleStatus(receipt),
    execution: executionEvidence(receipt).success ? 'SUCCESS' : 'UNCONFIRMED_OR_FAILED',
    executionResult: executionEvidence(receipt).result,
    consensusResult: consensusResult(receipt),
    leaderOnly: receipt?.leader_only ?? null,
    votes: receipt?.consensus_data?.votes ?? {},
    createdAt: receipt?.created_at ?? null,
    observedAt: new Date().toISOString()
  };
}

export function assertExpectedRollback(receipt,expectedPayload) {
  const lifecycle=lifecycleStatus(receipt);
  if(!['ACCEPTED','FINALIZED'].includes(lifecycle))throw new Error(`Expected rollback is not an accepted consensus outcome (${lifecycle}).`);
  if(consensusResult(receipt)!=='MAJORITY_AGREE')throw new Error(`Expected rollback lacks validator majority agreement (${consensusResult(receipt)}).`);
  const receipts=receipt?.consensus_data?.leader_receipt;
  const entries=Array.isArray(receipts)?receipts:receipts?[receipts]:[];
  const leader=entries.filter(item=>item?.mode==='leader').at(-1);
  if(!leader)throw new Error('No explicit leader receipt establishes the expected rollback.');
  if(receipt.leader_only!==false)throw new Error('Expected rollback evidence must come from a full validator run.');
  if(leader.execution_result!=='ERROR'||leader.result?.status!=='rollback'||leader.result?.payload!==expectedPayload) {
    throw new Error(`Expected rollback was not established: execution=${leader.execution_result??'UNKNOWN'}, status=${leader.result?.status??'UNKNOWN'}, payload=${leader.result?.payload??'UNKNOWN'}.`);
  }
  return receipt;
}
