// Preserve the official NOAA dictionary byte-for-byte; never synthesize its text.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// AWS Open Data registry identifies this bucket as NOAA-managed GHCN Daily.
export const SOURCE_URL = 'https://noaa-ghcn-pds.s3.amazonaws.com/readme.txt';
export const AUTHORITY_URL = 'https://registry.opendata.aws/noaa-ghcn/';
export const sourceFile = new URL('../public/evidence/noaa-ghcn-readme.txt',import.meta.url);
export const sourceMetadata = new URL('../public/evidence/noaa-source.json',import.meta.url);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function loadSource() {
  const bytes = await readFile(sourceFile);
  const metadata = JSON.parse(await readFile(sourceMetadata,'utf8'));
  assert.equal(metadata.url,SOURCE_URL,'Unexpected source URL.');
  assert.equal(metadata.sha256,sha256(bytes),'Captured source does not match recorded digest.');
  assert.equal(metadata.bytes,bytes.length,'Source length differs from record.');
  assert.deepEqual(Buffer.from(bytes.toString('utf8'),'utf8'),bytes,'Source is not reversible UTF-8.');
  return {...metadata,text:bytes.toString('utf8')};
}

export async function captureSource() {
  const response = await fetch(SOURCE_URL,{signal:AbortSignal.timeout(30000),redirect:'error'});
  if (!response.ok) throw new Error(`NOAA dictionary fetch returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length>10000 && bytes.length<100000,'Unexpected dictionary length.');
  assert.deepEqual(Buffer.from(bytes.toString('utf8'),'utf8'),bytes,'Dictionary is not reversible UTF-8.');
  const text = bytes.toString('utf8');
  assert.ok(text.includes('TMAX')&&text.includes('PRCP')&&text.includes('-9999'),'Response is not the expected GHCN Daily dictionary.');
  const metadata = {url:SOURCE_URL,authorityRegistry:AUTHORITY_URL,sha256:sha256(bytes),bytes:bytes.length,retrievedAt:new Date().toISOString(),encoding:'UTF-8',lineEndings:'preserved',httpStatus:response.status,lastModified:response.headers.get('last-modified'),etag:response.headers.get('etag'),notice:'Unmodified NOAA-managed GHCN Daily AWS distribution documentation. This snapshot is documentation, not demo weather observations.'};
  await mkdir(new URL('../public/evidence/',import.meta.url),{recursive:true});
  await writeFile(sourceFile,bytes);
  await writeFile(sourceMetadata,JSON.stringify(metadata,null,2)+'\n');
  return metadata;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const result = process.argv.includes('--verify') ? await loadSource() : await captureSource();
  const {text,...metadata}=result;
  console.log(JSON.stringify(metadata,null,2));
}
