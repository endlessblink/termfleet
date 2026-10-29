import test from 'node:test';import assert from 'node:assert/strict';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {linkProblem} from '../bridge/requirements.mjs';
const url='https://pc.tail1.ts.net:8810/workspace?view=one';const local='http://127.0.0.1:8811/workspace?view=one';
function fixture(t,{localStatus=403,publicStatus=200,publicBody='<html>Workspace</html>',publicError}={}){
 const original=childProcess.spawnSync,prior=process.env.TERMFLEET_TAILSCALE_SERVE_JSON,calls=[];
 process.env.TERMFLEET_TAILSCALE_SERVE_JSON=JSON.stringify({Web:{'pc.tail1.ts.net:8810':{Handlers:{'/':{Proxy:'http://127.0.0.1:8811'}}}}});
 childProcess.spawnSync=(command,args,options)=>{if(args?.[0]!=='-e')return original(command,args,options);const urls=JSON.parse(args[2]);calls.push(...urls);assert.doesNotMatch(args[1],/tailscale-user-login|authorization|cookie|x-forwarded-host/i,'never forge authentication');return{stdout:JSON.stringify(urls.map(target=>target===local?{url:target,status:localStatus,body:'Forbidden'}:publicError?{url:target,error:publicError}:{url:target,status:publicStatus,body:publicBody}))};};syncBuiltinESMExports();
 t.after(()=>{childProcess.spawnSync=original;syncBuiltinESMExports();if(prior===undefined)delete process.env.TERMFLEET_TAILSCALE_SERVE_JSON;else process.env.TERMFLEET_TAILSCALE_SERVE_JSON=prior;});return calls;
}
test('protected mapped local refusal retries exact HTTPS path without forged identity',t=>{const calls=fixture(t);assert.equal(linkProblem(url),null);assert.deepEqual(calls,[local,url]);});
for(const status of [401,403,404,500])test('original HTTPS '+status+' remains a failed read check',t=>{const calls=fixture(t,{publicStatus:status});assert.match(linkProblem(url),new RegExp('answered '+status));assert.deepEqual(calls,[local,url]);});
test('original HTTPS error body remains rejected',t=>{fixture(t,{publicBody:'Bad gateway'});assert.match(linkProblem(url),/error page/);});
test('original HTTPS timeout remains rejected',t=>{fixture(t,{publicError:'timeout'});assert.match(linkProblem(url),/did not answer/);});
test('successful local route needs no retry',t=>{const calls=fixture(t,{localStatus:200});assert.equal(linkProblem(url),null);assert.deepEqual(calls,[local]);});
test('ordinary local missing page is not retried or exempted',t=>{const calls=fixture(t,{localStatus:404});assert.match(linkProblem(url),/answered 404/);assert.deepEqual(calls,[local]);});
