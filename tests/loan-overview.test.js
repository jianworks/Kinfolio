import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {toTwd,FX} from '../public/domain.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function loansAt('),source.indexOf('function totals('))+source.slice(source.indexOf('function loanTable('),source.indexOf('function goalPage('));
function render(holder,asOf='2026-10-31'){
 return runInNewContext(functions+';loanTable()',{
  holder,asOf,FX,toTwd,esc:String,fmt:String,holderName:id=>id,
  empty:(title,note,button)=>title+note+button,
  btn:()=>'<button data-action="loan">新增貸款</button>',
  state:{loans:[{id:'one',holder_id:'a',name:'房貸',currency:'TWD'},{id:'two',holder_id:'b',name:'另一人的貸款',currency:'USD'}],loan_balances:[{id:1,loan_id:'one',date:'2026-09-30',balance:10000,rate:FX},{id:2,loan_id:'one',date:'2026-10-31',balance:9000,rate:FX}]}
 });
}
test('loan table filters by holder and retains create, balance and history controls',()=>{
 const html=render('a');
 assert.match(html,/房貸/);assert.doesNotMatch(html,/另一人的貸款/);
 assert.match(html,/data-action="loan"/);assert.match(html,/data-loan="one"/);assert.match(html,/data-loan-history="one"/);
 assert.match(html,/9000/);
});
test('loan table uses the inspection date and handles no records or loans',()=>{
 const historical=render('a','2026-10-01');
 assert.match(historical,/10000/);assert.doesNotMatch(historical,/9000/);
 assert.match(render('a','2026-01-01'),/尚無記錄/);
 assert.match(render('c'),/新增貸款/);
});
test('overview places loans immediately after accounts and removes the loan navigation page',()=>{
 assert.match(source,/\$\{accountTable\(\)\}\$\{loanTable\(\)\}/);
 assert.doesNotMatch(source,/loans: "貸款管理"|loans: loanPage|function loanPage/);
});
