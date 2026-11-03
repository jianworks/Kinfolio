import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import worker from '../src/worker.js';
import {hash} from '../src/auth.js';

test('family members share owner data while retaining their login identities',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']}));
 try{
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){
   const triggers=[];
   const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/^--.*$/gm,'').replace(/CREATE TRIGGER[\s\S]*?\nEND;/g,trigger=>{triggers.push(trigger);return `TRIGGER_${triggers.length-1};`;});
   for(let statement of sql.split(';').map(s=>s.trim()).filter(Boolean)){
    if(statement.startsWith('PRAGMA'))continue;
    if(statement.startsWith('TRIGGER_'))statement=triggers[Number(statement.slice(8))];
    await db.prepare(statement).run();
   }
  }
  await db.batch([
   db.prepare("INSERT INTO users VALUES('owner','cs.jian@mrandmrsjian.com','Owner'),('member','cc.chang@mrandmrsjian.com','Member')"),
   db.prepare("INSERT INTO revisions(user_id) VALUES('owner'),('member')"),
   db.prepare("INSERT INTO holders VALUES('existing','owner','張佳琪'),('private','member','保留的舊資料')"),
   db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?),(?,?,?)').bind(await hash('owner-token'),'owner',Math.floor(Date.now()/1000)+3600,await hash('member-token'),'member',Math.floor(Date.now()/1000)+3600),
  ]);
  const env={DB:db,FAMILY_DATA_OWNER_EMAIL:'cs.jian@mrandmrsjian.com'};
  async function call(path,body,person='owner',customEnv=env){
   const r=await worker.fetch(new Request('https://kinfolio.example/api/'+path,{method:body?'POST':'GET',headers:{...(person?{Cookie:'__Host-kinfolio_session='+person+'-token'}:{}),...(body?{'Content-Type':'application/json',Origin:'https://kinfolio.example'}:{})},...(body?{body:JSON.stringify(body)}:{})}),customEnv);
   return {status:r.status,data:await r.json()};
  }
  const owner=await call('state'); const member=await call('state',null,'member');
  assert.equal(member.status,200);
  assert.equal(member.data.user.id,'member');
  assert.deepEqual(member.data.holders,owner.data.holders);
  assert.equal(member.data.holders[0].id,'existing');
  const created=await call('goals',{holderId:'existing',name:'Initial',target:100,date:'2030-01-01',basis:'assets',version:0},'member');
  assert.equal(created.status,200);
  assert.equal((await call('state')).data.holders.length,1);
  assert.equal((await call('holders',{name:'Stale',version:0})).status,409);
  const shared=(await call('state')).data;
  assert.equal(shared.revisions[0].version,1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM holders WHERE user_id='member'").first()).n,1);
  const plan={start:'2026-11',opening:1000000,floor:10000,items:[{id:'row',name:'收入',direction:'income',values:Array(12).fill(0)}]};
  assert.equal((await call('cash-plan',{plan,version:1},'member')).status,200);
  assert.deepEqual((await call('state')).data.cash_plans,(await call('state',null,'member')).data.cash_plans);
  async function write(path,body,person='member') {
   const version=(await call('state',null,person)).data.revisions[0].version;
   const r=await call(path,{...body,version},person);
   assert.equal(r.status,200,JSON.stringify(r.data));
  }
  await write('accounts',{holderId:'existing',name:'Shared account',type:'股票',currency:'TWD',date:'2020-01-01',principal:100,value:120,rate:1});
  await write('loans',{holderId:'existing',name:'Shared loan',currency:'TWD',date:'2020-01-01',balance:50,rate:1,annualRate:0});
  await write('goals',{holderId:'existing',name:'Shared goal',target:1000,date:'2030-01-01',basis:'assets'});
  const aState=(await call('state')).data, bState=(await call('state',null,'member')).data;
  for(const table of ['accounts','events','loans','loan_balances','goals','cash_plans','revisions'])assert.deepEqual(aState[table],bState[table]);
  assert.equal(aState.accounts.length,1);assert.equal(aState.loans.length,1);assert.equal(aState.goals.length,2);
  await write('delete',{table:'goals',id:aState.goals[0].id},'owner');
  assert.equal((await call('state',null,'member')).data.goals.length,1);
  await write('holders',{name:'簡仲研'},'owner');
  const otherHolder=(await call('state')).data.holders.find(h=>h.name==='簡仲研');
  await write('accounts',{holderId:otherHolder.id,name:'Other secret account',type:'股票',currency:'TWD',date:'2020-01-01',principal:300,value:400,rate:1},'owner');
  const otherAccount=(await call('state')).data.accounts.find(a=>a.holder_id===otherHolder.id);
  const restricted=(await call('state',null,'member')).data;
  assert.equal(restricted.access.allHolders,false);
  assert.deepEqual(restricted.holders.map(h=>h.name),['張佳琪']);
  assert.ok(!JSON.stringify(restricted).includes('Other secret account'));
  assert.equal((await call('holders',{name:'Unauthorized',version:restricted.revisions[0].version},'member')).status,403);
  assert.equal((await call('accounts',{holderId:otherHolder.id,name:'Denied',type:'股票',currency:'TWD',date:'2020-01-01',principal:0,value:0,rate:1,version:restricted.revisions[0].version},'member')).status,400);
  assert.equal((await call('events',{kind:'valuation',accountId:otherAccount.id,date:'2020-02-01',value:900,rate:1,version:restricted.revisions[0].version},'member')).status,400);
  const exported=(await call('export',null,'member')).data;
  assert.equal(exported.user.id,'member');
  assert.deepEqual(exported.holders,restricted.holders);
  assert.ok(!JSON.stringify(exported).includes('Other secret account'));
  assert.equal((await call('state',null,null)).status,401);
  assert.equal((await call('state',null,'member',{...env,FAMILY_DATA_OWNER_EMAIL:'missing@mrandmrsjian.com'})).status,503);
  // All asset modules receive the same shared data owner, not the session actor.
  for(const table of ['accounts','events','loans','loan_balances','goals','portfolios','holdings','portfolio_snapshots','portfolio_current'])assert.deepEqual(owner.data[table],member.data[table]);
 }finally{await mf.dispose();}
});
