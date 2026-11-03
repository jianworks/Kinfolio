import test from 'node:test';
import assert from 'node:assert/strict';
import {familyAccess,scopeFamilyData} from '../src/family-data.js';
const request=new Request('https://kinfolio.example/api/state');
const env={FAMILY_DATA_OWNER_EMAIL:'cs.jian@mrandmrsjian.com'};
const names=['張佳琪','簡仲研','簡仲晴'];
const data={holders:names.map((name,i)=>({id:String(i),name})),accounts:names.map((_,i)=>({id:'a'+i,holder_id:String(i)})),loans:names.map((_,i)=>({id:'l'+i,holder_id:String(i)})),events:[{id:1,account_id:'a0',kind:'transfer_out',transfer_id:'cross',amount:-10},{id:2,account_id:'a1',kind:'transfer_in',transfer_id:'cross',amount:10}],loan_balances:names.map((_,i)=>({loan_id:'l'+i})),goals:names.map((_,i)=>({holder_id:String(i)})),cash_plans:[],revisions:[],...Object.fromEntries(['portfolios','holdings','portfolio_snapshots','portfolio_current'].map(t=>[t,names.map((_,i)=>({account_id:'a'+i}))]))};
test('each named family account sees only its assigned holder and asset rows',()=>{
 for(const [i,email] of ['cc.chang@mrandmrsjian.com','quentin.jian@mrandmrsjian.com','blair.jian@mrandmrsjian.com'].entries()){
  const access=familyAccess(request,env,{email},data);
  const scoped=scopeFamilyData(data,access);
  assert.deepEqual(scoped.holders.map(h=>h.name),[names[i]]);
  assert.deepEqual(scoped.accounts.map(a=>a.id),['a'+i]);
  assert.deepEqual(scoped.loans.map(a=>a.id),['l'+i]);
  assert.equal(scoped.goals.length,1);
  for(const table of ['portfolios','holdings','portfolio_snapshots','portfolio_current'])assert.deepEqual(scoped[table].map(r=>r.account_id),['a'+i]);
  if(i<2){assert.equal(scoped.events.length,1);assert.equal(scoped.events[0].transfer_id,null);}
 }
});
test('owner sees all; unknown accounts and missing/ambiguous names see no assets',()=>{
 const access=familyAccess(request,env,{email:'CS.JIAN@mrandmrsjian.com'},data);
 assert.equal(access.allHolders,true);assert.equal(scopeFamilyData(data,access),data);
 assert.deepEqual(familyAccess(request,env,{email:'unknown@mrandmrsjian.com'},data).holderIds,[]);
 assert.deepEqual(familyAccess(request,env,{email:'cc.chang@mrandmrsjian.com'},{...data,holders:[]}).holderIds,[]);
 assert.deepEqual(familyAccess(request,env,{email:'cc.chang@mrandmrsjian.com'},{...data,holders:[...data.holders,{id:'duplicate',name:'張佳琪'}]}).holderIds,[]);
});
