require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
const path = require('node:path');
const fs = require('node:fs/promises');
const net = require('node:net');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname,'..');
const assets = path.join(process.env.VANTILO_TEST_ARTIFACT_ROOT,'ordered-reader-build');
async function port() { const server=net.createServer(); await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);}); const value=server.address().port; await new Promise(resolve=>server.close(resolve)); return value; }
async function run(command,args,env) { const child=spawn(command,args,{cwd:repo,env:{...process.env,...env},stdio:'inherit'}); const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}); if(code!==0)throw new Error(`子任务失败 (${code})`); }
(async()=>{
  const manual=process.env.VANTILO_ORDERED_DEV_MANUAL === '1';
  const api=manual ? 5174 : await port(); let web=manual ? 5175 : await port();
  if (!manual) while(api===web) web=await port();
  const env={VANTILO_READER_BUILD_OUTPUT:assets,VANTILO_SWIFT_MODULE_CACHE_PATH:path.join(process.env.VANTILO_TEST_ARTIFACT_ROOT,'ordered-swift'),VANTILO_TRANSLATION_READER:'1',VANTILO_CATALOG_READER_PREVIEW:'1',VANTILO_LEARNING_API_PORT:String(api),VANTILO_LEARNING_WEB_PORT:String(web)};
  if (process.env.VANTILO_ORDERED_DEV_MANUAL === '1') {
    // Human acceptance uses the genuine Vantilo development renderer + Reader,
    // with all writable data and build outputs owned by this Workspace run.
    const profile = path.join(process.env.VANTILO_TEST_PROFILE_ROOT,'vantilo-dev-human');
    await fs.mkdir(profile,{recursive:true,mode:0o700});
    const restore = process.env.VANTILO_DEV_PROFILE_RESTORE_DIR;
    if (restore) {
      const expected = '/Volumes/Workspace/Development/Vantilo/acceptance/0.1.14/codex-writing-preview-20261108/vantilo-dev-human';
      if (restore !== expected || await fs.realpath(restore) !== expected) throw new Error('拒绝从未审核的目录恢复开发配置');
      const existing = await fs.readdir(profile);
      if (existing.length) throw new Error('开发 profile 不为空，拒绝覆盖');
      await fs.rmdir(profile); // Only the just-created, verified-empty directory.
      await fs.cp(restore,profile,{recursive:true,force:false,errorOnExist:true});
      // Chromium's running-instance links refer to the old process and must not be reused.
      for (const name of ['SingletonLock','SingletonSocket','SingletonCookie']) {
        await fs.rm(path.join(profile,name),{force:true});
      }
      const localStorage = path.join(profile,'Local Storage','leveldb','CURRENT');
      await fs.access(localStorage);
      console.log('VANTILO_DEV_MANUAL_PROFILE_RESTORED=YES (Workspace isolated backup)');
    }
    console.log('VANTILO_DEV_MANUAL_START: isolated Vantilo 0.1.14; choose Practice Lab in the left navigation. Enter the DeepSeek API Key only in the app; never in logs.');
    console.log('VANTILO_DEV_MANUAL_PROFILE=' + profile);
    await run('npm',['run','desktop:dev'],{...env,VANTILO_DEV_USER_DATA_DIR:profile,VANTILO_READER_BUILD_OUTPUT:assets});
    return;
  }
  await run('npm',['run','build:reader'],env);
  // Only the standalone AI Workshop remains. Retired curated-lesson exercises
  // and their Codex-only synthetic/real test paths are no longer launched.
  await run(process.execPath,[path.join(repo,'node_modules/electron/cli.js'),path.join(repo,'scripts/verify-ordered-practice.cjs')],{...env,VANTILO_ORDERED_MODE:'workshop',VANTILO_TEST_PROFILE_ROOT:path.join(process.env.VANTILO_TEST_PROFILE_ROOT,'workshop'),VANTILO_TEST_CHROMIUM_ROOT:path.join(process.env.VANTILO_TEST_CHROMIUM_ROOT,'workshop')});
})().catch(error=>{console.error(`ORDERED_RUNNER_FAIL ${error.message}`);process.exitCode=1;});
