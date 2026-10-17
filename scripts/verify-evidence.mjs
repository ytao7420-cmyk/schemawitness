import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {sha256,SOURCE_URL} from './capture-source.mjs';

export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}

export function digestOf(value) {
  const {digest,...preimage}=value;
  return sha256(canonical(preimage));
}

export function verifyMapping({plan,dictionary,attestation},preset,source) {
  assert.equal(plan.id,preset.id);
  assert.equal(plan.element,preset.element);
  assert.deepEqual(plan.target,preset.target);
  assert.equal(plan.digest,digestOf(plan),'Plan digest differs.');
  assert.equal(dictionary.url,SOURCE_URL);
  assert.equal(dictionary.sha256,sha256(dictionary.text));
  assert.equal(dictionary.sha256,source.sha256);
  assert.equal(dictionary.text,source.text,'On-chain source is not the exact local official snapshot.');
  assert.equal(dictionary.byte_length,Buffer.byteLength(dictionary.text,'utf8'));
  assert.equal(dictionary.line_count,dictionary.text.split('\n').length);
  assert.equal(dictionary.digest,digestOf(dictionary));
  assert.equal(plan.dictionary_sha256,dictionary.sha256);
  assert.equal(attestation.source_sha256,dictionary.sha256);
  assert.equal(attestation.dictionary_digest,dictionary.digest);
  assert.equal(attestation.plan_digest,plan.digest);
  assert.equal(attestation.digest,digestOf(attestation));
  assert.deepEqual(attestation.target,preset.target);
  assert.equal(attestation.status,preset.expectedAttestation,'Observed semantic result differs from expected demo outcome.');
  const lines=dictionary.text.split('\n');
  for(const citation of attestation.semantics.citations) {
    assert.ok(Number.isInteger(citation.start_line)&&Number.isInteger(citation.end_line));
    assert.ok(citation.start_line>=1&&citation.start_line<=citation.end_line&&citation.end_line<=lines.length);
    assert.equal(citation.quote,lines.slice(citation.start_line-1,citation.end_line).join('\n'),'Citation quote differs from original source lines.');
  }
  assert.ok(attestation.semantics.citations.length,'Demonstrated known mappings must have supporting citations.');
}

export function verifyNormalization(results,preset) {
  assert.equal(results.length,preset.samples.length);
  assert.equal(results.length,preset.expectedResults.length);
  for(let i=0;i<results.length;i++) {
    const result=results[i],expected=preset.expectedResults[i];
    assert.deepEqual(result.input,preset.samples[i],`Input ${i} was altered.`);
    assert.equal(result.status,expected.status,`Sample ${i} status differs.`);
    if(expected.status==='VALUE') {
      assert.deepEqual(result.normalized,expected.normalized,`Sample ${i} exact rational conversion differs.`);
      assert.ok(Number.isSafeInteger(result.normalized.numerator)&&Number.isSafeInteger(result.normalized.denominator)&&result.normalized.denominator>0);
    } else assert.equal(result.normalized,null,`Excluded/trace sample ${i} must not masquerade as a numeric measurement.`);
  }
}

export function verifySampleReceipt(receipt,mapping,preset,recorder) {
  assert.equal(receipt.id,preset.receiptId);
  assert.equal(receipt.recorder.toLowerCase(),recorder.toLowerCase());
  assert.equal(receipt.plan_owner.toLowerCase(),mapping.plan.owner.toLowerCase());
  assert.equal(receipt.plan_id,preset.id);
  assert.equal(receipt.source_sha256,mapping.dictionary.sha256);
  assert.equal(receipt.plan_digest,mapping.plan.digest);
  assert.equal(receipt.attestation_digest,mapping.attestation.digest);
  assert.deepEqual(receipt.samples,preset.samples);
  assert.equal(receipt.samples_digest,sha256(canonical(preset.samples)));
  assert.equal(receipt.digest,digestOf(receipt));
  assert.match(receipt.input_provenance,/caller-supplied/i);
  verifyNormalization(receipt.results,preset);
}

export function verifyNegativeTransaction(item,archive) {
  assert.match(item.hash,/^0x[\da-f]{64}$/i);
  assert.ok(['ACCEPTED','FINALIZED'].includes(item.status),'Expected rejection requires an accepted lifecycle.');
  assert.equal(item.consensusResult,'MAJORITY_AGREE','Expected rejection must be agreed by validators.');
  assert.equal(item.execution,'ERROR');
  assert.equal(item.executionResult,'ERROR');
  assert.equal(item.leaderOnly,false);
  assert.equal(item.spec.kind,'call','Negative evidence must be a contract call.');
  assert.equal(item.spec.address.toLowerCase(),archive.contractAddress.toLowerCase(),'Negative transaction targets another contract.');
  assert.equal(item.spec.actor.toLowerCase(),archive.actors.recorder.toLowerCase(),'Negative transaction actor differs from recorder.');
  assert.equal(item.spec.value,'0');
  assert.equal(item.expectedFailure,true);
  assert.equal(item.expectedRollbackVerified,true);
  assert.equal(item.leaderResultStatus,'rollback');
  assert.equal(item.decodedRollback,'Normalization requires an accepted semantic mapping');
  assert.equal(item.spec.expectedRollback,item.decodedRollback);
  assert.equal(item.outcome,'EXPECTED_REJECTION');
}

export function verifyArchive(archive,preset,source) {
  assert.equal(archive.chainId,61999);
  assert.equal(archive.presetDigest,sha256(canonical(preset)));
  assert.match(archive.contractAddress,/^0x[\da-f]{40}$/i);
  assert.equal(archive.mappings.length,preset.plans.length);
  assert.equal(archive.transactions.length,11,'Expected create/capture/attest for three plans plus two sample recordings.');
  assert.equal(archive.negativeTransactions?.length,1,'Expected one separately recorded rejection test.');
  for(const fixture of preset.plans) {
    const mapping=archive.mappings.find(item=>item.plan.id===fixture.id);
    assert.ok(mapping,'Mapping missing from evidence.');
    verifyMapping(mapping,fixture,source);
    assert.equal(mapping.plan.owner.toLowerCase(),archive.actors.creator.toLowerCase());
    if(fixture.expectedAttestation==='ACCEPTED') {
      verifyNormalization(mapping.preview,fixture);
      verifySampleReceipt(mapping.receipt,mapping,fixture,archive.actors.recorder);
      assert.deepEqual(mapping.preview,mapping.receipt.results);
    } else {
      assert.equal(mapping.normalizationBlocked,true,'Mismatch mapping must not normalize samples.');
      assert.equal(mapping.receipt,null,'Mismatch demo must not publish a conversion receipt.');
      assert.equal(mapping.negativeReceiptReadBack,null,'Failed write must not create a sample receipt.');
      const negative=archive.negativeTransactions.find(tx=>tx.hash===mapping.negativeTransactionHash);
      assert.ok(negative,'Mismatch evidence must refer to the expected-rollback transaction.');
      assert.equal(negative.spec.method,'record_samples');
      assert.equal(negative.spec.args[0].toLowerCase(),mapping.plan.owner.toLowerCase());
      assert.deepEqual(negative.spec.args.slice(1),[fixture.id,mapping.negativeReceiptId,JSON.stringify(fixture.samples)]);
    }
  }
  for(const item of archive.transactions) {
    assert.match(item.hash,/^0x[\da-f]{64}$/i);
    assert.ok(['ACCEPTED','FINALIZED'].includes(item.status));
    assert.equal(item.consensusResult,'MAJORITY_AGREE');
    assert.equal(item.execution,'SUCCESS');
    assert.equal(item.leaderOnly,false);
    assert.equal(item.spec.value,'0');
  }
  for(const item of archive.negativeTransactions)verifyNegativeTransaction(item,archive);
  assert.equal(new Set(archive.transactions.map(tx=>tx.hash)).size,archive.transactions.length,'Repeated transaction hash in archive.');
  assert.equal(new Set([...archive.transactions,...archive.negativeTransactions].map(tx=>tx.hash)).size,12,'Negative transaction must be separate from the success records.');
  return {verified:true,mappings:archive.mappings.length,successfulTransactions:archive.transactions.length,expectedRejectionTransactions:archive.negativeTransactions.length,sourceSha256:source.sha256,notice:'Offline integrity verification of recorded evidence; no current network or reward status is asserted.'};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const {loadSource}=await import('./capture-source.mjs');
  const archive=JSON.parse(await readFile(new URL('../public/evidence/demo.json',import.meta.url),'utf8'));
  const preset=JSON.parse(await readFile(new URL('demo-preset.json',import.meta.url),'utf8'));
  console.log(JSON.stringify(verifyArchive(archive,preset,await loadSource()),null,2));
}
