import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function transferHistoryTable()'),source.indexOf('let transferHistoryDialog'));
function render(holder,asOf='2026-10-31'){
 const accounts=[{id:'a',holder_id:'one',name:'Source',currency:'TWD'},{id:'b',holder_id:'two',name:'Target',currency:'USD'}];
 const events=[{id:1,kind:'transfer_out',account_id:'a',transfer_id:'t',date:'2026-10-01',amount:-3200,cost_delta:-3200,note:'Cross-holder'},{id:2,kind:'transfer_in',account_id:'b',transfer_id:'t',date:'2026-10-01',amount:100,cost_delta:100}];
 return runInNewContext(fn+';transferHistoryTable()', {state:{accounts,events},holder,asOf,esc:String,fmt:String,holderName:String,empty:()=> 'EMPTY'});
}
test('history includes transfers involving either holder exactly once',()=>{
 for(const holder of ['one','two','all']){
  const html=render(holder);
  assert.match(html,/Source → Target/);
  assert.equal((html.match(/Cross-holder/g)||[]).length,1);
  assert.match(html,/TWD 3200/);assert.match(html,/USD 100/);
 }
});
test('history respects inspection dates and unrelated holder filters',()=>{
 assert.match(render('one','2026-09-30'),/EMPTY/);
 assert.match(render('unrelated'),/EMPTY/);
});
