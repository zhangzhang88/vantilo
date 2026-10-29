import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexPrepRuntime } from "./codex-prep-runtime.js";

const roots: string[] = [];
const runtimes: CodexPrepRuntime[] = [];
afterEach(async () => { runtimes.splice(0).forEach((runtime) => runtime.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(idle = 300000, timeout = 3000) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-prep-runtime-")); roots.push(root);
  const binary = path.join(root, "fake-codex.mjs");
  await writeFile(binary, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const send = (value) => process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const event=JSON.parse(line); if(!event.id)return;
 appendFileSync('calls.jsonl',JSON.stringify({pid:process.pid,method:event.method,params:event.params,isolated:process.env.HOME===process.env.CODEX_HOME})+'\\n');
 send({id:event.id,result:event.method==='thread/start'?{thread:{id:'synthetic-thread'}}:event.method==='model/list'?(event.params.cursor?{data:[{id:'model-b',model:'synthetic-model-b',displayName:'Synthetic B',isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Low'}],upgrade:null,upgradeInfo:null}],nextCursor:null}:{data:[{id:'model-a',model:'synthetic-model-a',displayName:'Synthetic A',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Low'},{reasoningEffort:'medium',description:'Medium'}],upgrade:null,upgradeInfo:null}],nextCursor:'next'}):{}});
 if(event.method==='turn/start'){
  const text=event.params.input[0].text;
  if(text==='stall')return;
  send({method:'item/agentMessage/delta',params:{delta:'第一段'}});
  if(text==='cancel')return;
   setTimeout(()=>{
   if(event.params.model==='synthetic-reroute') send({method:'model/rerouted',params:{toModel:'synthetic-effective-model'}});
   send({method:'item/agentMessage/delta',params:{delta:'第二段'}});
   send({method:'turn/completed',params:{turn:{status:text==='fail'?'failed':'completed'}}});
  },10);
 }
});`, { mode: 0o700 });
  const runtime = new CodexPrepRuntime(idle, timeout); runtimes.push(runtime);
  const run = (text: string, key = "book-a:chapter-1", token = "synthetic-token", options = {}) => runtime.run(text, token, root, binary, { sessionKey: key, ...options });
  const listModels = () => runtime.listModels("synthetic-token", root, binary);
  const calls = async () => (await readFile(path.join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { run, calls, listModels, runtime };
}
describe("isolated Codex prep sessions", () => {
  it("streams before completion and reuses the same process and thread with only the new request", async () => {
    const { run, calls } = await fixture();
    const chunks: string[] = [];
    await expect(run("full context", undefined, undefined, { onDelta: (text: string) => chunks.push(text) })).resolves.toBe("第一段第二段");
    expect(chunks).toEqual(["第一段", "第二段"]);
    await run("full context again", undefined, undefined, { continuedInput: "new request" });
    const recorded = await calls();
    expect(recorded.filter((call) => call.method === "initialize")).toHaveLength(1);
    expect(recorded.filter((call) => call.method === "thread/start")).toHaveLength(1);
    expect(recorded.filter((call) => call.method === "turn/start").map((call) => call.params.input[0].text)).toEqual(["full context", "new request"]);
    expect(recorded.every((call) => call.isolated)).toBe(true);
    expect(recorded.find((call) => call.method === "thread/start").params).toMatchObject({ sandbox: "read-only", ephemeral: true, approvalPolicy: "never" });
  });
  it("discovers model metadata dynamically and records explicit model and effort, including reroutes", async () => {
    const { run, calls, listModels } = await fixture();
    await expect(listModels()).resolves.toMatchObject([{ model: "synthetic-model-a", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }] }, { model: "synthetic-model-b", isDefault: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }]);
    const usage: unknown[] = [];
    await run("targeted", undefined, undefined, { model: "synthetic-reroute", reasoningEffort: "high", onModelUsage: (value: unknown) => usage.push(value) });
    const turn = (await calls()).find((call) => call.method === "turn/start");
    expect(turn.params).toMatchObject({ model: "synthetic-reroute", effort: "high" });
    expect(usage).toMatchObject([{ modelId: "synthetic-effective-model", requestedModelId: "synthetic-reroute", reasoningEffort: "high", requestedReasoningEffort: "high" }]);
  });
  it("separates sources and replaces sessions when the OAuth token changes", async () => {
    const { run, calls } = await fixture();
    await run("a"); await run("b", "book-b:chapter-1"); await run("c", undefined, "renewed-synthetic-token");
    expect((await calls()).filter((call) => call.method === "initialize")).toHaveLength(3);
  });
  it("discards failed sessions and aborted partial replies", async () => {
    const { run, calls } = await fixture();
    await expect(run("fail")).rejects.toThrow("Codex 本轮未完成（failed）");
    const controller = new AbortController();
    await expect(run("cancel", undefined, undefined, { signal: controller.signal, onDelta: () => controller.abort() })).rejects.toThrow("中断");
    await run("recovered");
    expect((await calls()).filter((call) => call.method === "initialize")).toHaveLength(3);
  });
  it("expires idle sessions and stops stalled requests", async () => {
    const { run, calls } = await fixture(20, 500);
    await run("first");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await run("second");
    expect((await calls()).filter((call) => call.method === "initialize")).toHaveLength(2);
    await expect(run("stall")).rejects.toThrow("超时");
  });
  it("rebuilds after ten turns and explicitly forgets a previous research scope", async () => {
    const { run, calls, runtime } = await fixture();
    for (let index = 0; index < 11; index++) await run("request");
    expect((await calls()).filter((call) => call.method === "initialize")).toHaveLength(2);
    runtime.forget("book-a:chapter-1");
    await run("new scope context");
    expect((await calls()).filter((call) => call.method === "initialize")).toHaveLength(3);
  });
  it("caps simultaneous session startup and closes active turns on shutdown", async () => {
    const { run, calls, runtime } = await fixture();
    const active = Array.from({ length: 4 }, (_, index) => run("stall", `book-${index}`));
    const results = Promise.allSettled(active);
    await expect(run("fifth", "book-fifth")).rejects.toThrow("任务较多");
    await vi.waitFor(async () => expect((await calls()).filter((call) => call.method === "turn/start")).toHaveLength(4));
    runtime.close();
    expect((await results).every((result) => result.status === "rejected")).toBe(true);
  });

});
