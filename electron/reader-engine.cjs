const {EventEmitter}=require('node:events');

// Two execution lanes, one implementation and shared native credential store.
// The factory supplies a separate Runtime/Driver, never a second login flow.
class ReaderEngine extends EventEmitter {
  constructor({createRuntime,accountStatus}) {
    super();Object.assign(this,{createRuntime,accountStatus});
    this.runtime=null;this.starting=null;this.requests=new Map();this.closed=false;
  }
  get busy(){return this.requests.size>0 || Boolean(this.runtime?.activeTask);}
  async ensureStarted(){
    if(this.closed)throw new Error('阅读引擎已停止');
    if(this.runtime?.getStatus().status==='ready')return this.runtime;
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      if(this.runtime)await this.runtime.stop();
      const runtime=await this.createRuntime();this.runtime=runtime;
      runtime.driver.on('process-start',({pid})=>this.emit('process',{pid}));
      runtime.driver.on('process-exit',()=>this.emit('process',{pid:null}));
      runtime.on('event',event=>{
        if(event.type!=='message-delta')return;
        const scope=runtime.store.get(event.sessionId).readerScopeKey;
        const requestId=scope?.slice('reader-task:'.length);
        if(requestId && this.requests.has(requestId))this.emit('delta',{requestId,delta:event.delta.slice(0,20000)});
      });
      await runtime.start();await runtime.driver.start();
      if(this.closed){await runtime.stop();throw new Error('阅读引擎已停止');}
      return runtime;
    })().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async run(payload){
    if(this.closed)throw new Error('阅读引擎已停止');
    if(this.requests.size>=8)throw new Error('阅读任务较多，请稍后重试');
    const id=payload.requestId;
    if(id && this.requests.has(id))throw new Error('重复阅读请求');
    const ticket={cancelled:false,forwarded:false};if(id)this.requests.set(id,ticket);
    try{
      if(!(await this.accountStatus()).connected)throw new Error('请先登录 ChatGPT');
      if(ticket.cancelled)throw new Error('阅读任务已取消');
      const runtime=await this.ensureStarted();
      if(ticket.cancelled)throw new Error('阅读任务已取消');
      ticket.forwarded=true;
      return await runtime.runReaderAi(payload);
    }finally{if(id)this.requests.delete(id);}
  }
  cancel(requestId){
    const ticket=this.requests.get(requestId);if(!ticket)return {cancelled:false};
    ticket.cancelled=true;if(ticket.forwarded)this.runtime?.cancelReaderRequest(requestId);
    return {cancelled:true};
  }
  async reset(){
    if(this.busy)throw new Error('请先结束阅读任务');
    await this.runtime?.stop();this.runtime=null;
  }
  async stop(){
    this.closed=true;
    for(const id of this.requests.keys())this.cancel(id);
    await this.starting?.catch(()=>{});
    await this.runtime?.stop();this.runtime=null;
  }
}
module.exports={ReaderEngine};
