const API_PREFIX = 'https://api.github.com/repos/hehonghui/awesome-english-ebooks/contents/';
const RAW_PREFIX = 'https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/';
function createMagazineFetch({ fetchImpl = fetch, signal, onProgress = () => {} } = {}) {
  async function request(url,accept,limit,timeoutMs){
    const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{Accept:accept,'User-Agent':'Vantilo-magazine-sync','X-GitHub-Api-Version':'2022-11-28'},
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
    const tooLarge=()=>Object.assign(new Error('Magazine response too large'),{code:'MAGAZINE_TOO_LARGE'});
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw tooLarge();}
    const chunks=[];let length=0;
    for await(const chunk of response.body||[]){length+=chunk.length;if(length>limit)throw tooLarge();chunks.push(chunk);}
    return new Response(Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
  }
  return async (input, options = {}) => {
    const url=new URL(String(input));
    if(url.username||url.password||(!url.href.startsWith(API_PREFIX)&&!url.href.startsWith(RAW_PREFIX)))throw new Error('Unsupported magazine source');
    const publications={'01_economist':'The Economist','02_new_yorker':'The New Yorker','04_atlantic':'The Atlantic','05_wired':'Wired'};
    const source=Object.keys(publications).find(directory=>url.pathname.split('/').includes(directory));
    const raw=url.href.startsWith(RAW_PREFIX);
    if(source)onProgress(`${raw?'正在下载':'正在检查'} ${publications[source]}${raw?' EPUB':' 的新刊'}…（单次请求最多等待 60 秒）`);
    if(!raw)return request(url.href,'application/vnd.github+json',5*1024*1024,60000);
    try{
      const response=await request(url.href,'application/vnd.github+json',100*1024*1024,60000);
      if(response.ok)return response;
      await response.body?.cancel();
    }catch(error){if(signal?.aborted||error?.code==='MAGAZINE_TOO_LARGE')throw error;}
    signal?.throwIfAborted();
    // Same fixed repository, through GitHub's raw Contents representation.
    // Never accept an arbitrary fallback host or forward caller credentials.
    const alternative=API_PREFIX+url.href.slice(RAW_PREFIX.length).split('?')[0].split('/').map(segment=>encodeURIComponent(decodeURIComponent(segment))).join('/')+'?ref=master';
    if(source)onProgress(`正在通过 GitHub Contents 重试 ${publications[source]} EPUB…（最多等待 180 秒）`);
    return request(alternative,'application/vnd.github.raw+json',100*1024*1024,180000);
  };
}
module.exports={createMagazineFetch};
