// Pace only read operations. Never retry broadcasts with this helper.
export function retryAfterMs(error) {
  const seen=new Set();let current=error,rateLimitObserved=false;
  while(current&&typeof current==='object'&&!seen.has(current)) {
    seen.add(current);
    const limited=Number(current.code)===-32029||Number(current.status)===429||Number(current.statusCode)===429||/rate limit|too many requests/i.test(String(current.details??current.message??''));
    if(limited) {
      rateLimitObserved=true;
      const seconds=Number(current.data?.retry_after_seconds??current.retry_after_seconds);
      if(Number.isFinite(seconds)&&seconds>=0)return seconds*1000;
    }
    current=current.cause;
  }
  return rateLimitObserved?5000:null;
}

export function createReadScheduler({minIntervalMs=2200,maxAttempts=5,retryPaddingMs=500,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{}}={}) {
  let tail=Promise.resolve(),nextStart=0;
  return (operation,label='read')=>{
    const job=tail.then(async()=>{
      for(let attempt=1;attempt<=maxAttempts;attempt++) {
        const wait=Math.max(0,nextStart-now());
        if(wait)await sleep(wait);
        nextStart=now()+minIntervalMs;
        try {return await operation();}
        catch(error) {
          const delay=retryAfterMs(error);
          if(delay===null||attempt===maxAttempts)throw error;
          if(delay>60000)throw new Error(`Read ${label} is rate limited; server requests ${Math.ceil(delay/1000)} seconds before retry. Resume later.`,{cause:error});
          nextStart=Math.max(nextStart,now()+delay+retryPaddingMs);
          onRetry({label,attempt,retryAfterMs:Math.max(0,nextStart-now())});
        }
      }
      throw new Error('Read retry budget exhausted.');
    });
    tail=job.catch(()=>{});
    return job;
  };
}
