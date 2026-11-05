// Offline relearning demo: fallback rate on fuzzed inputs before/after retraining with the inputs
// that fell back on a disjoint fuzz set.
const fs=require("fs");const B="/tmp/opencode/pp-wt/react-bench/react-bench";
const util=require(B+"/harness-util.js"),data=require(B+"/data.js");const {React,ReactDOMServer}=require(B+"/react-deps.js");
const impl=require("../index.js");const {mutate,rng}=require("../fuzz.js");
const App=require(util.APP_JS_PATH);const src=fs.readFileSync(util.APP_JS_PATH,"utf8");
const base=data.getTrainingCorpus(200,"small");
const gen=(seed,n)=>{const g=rng(seed);return Array.from({length:n},()=>mutate(base[g.int(base.length)],g,1+g.int(2)));};
const learnSet=gen(101,2000), evalSet=gen(202,2000);
const train=data.getTrainingCorpus(60,"small").concat(data.getTrainingCorpus(10,"large"));
function evaluate(r){const f0=r.stats.fallbacks;let bad=0,thr=0;for(const d of evalSet){let w,g;try{w=ReactDOMServer.renderToString(React.createElement(App,{data:d}));}catch(e){w="E:"+e.message;thr++;}try{g=r.render(d);}catch(e){g="E:"+e.message;}if(w!==g)bad++;}return {fallbacks:r.stats.fallbacks-f0,throwing:thr,mismatches:bad};}
let r=impl.build(src,util.makePrepareOpts({trainingInputs:train,collectFallbacks:5000}));
const before=evaluate(r);
for(const d of learnSet){try{r.render(d);}catch(_e){}}
const extra=r.render.collected.filter(d=>{try{ReactDOMServer.renderToString(React.createElement(App,{data:d}));return true;}catch(_e){return false;}});
const r2=impl.build(src,util.makePrepareOpts({trainingInputs:train.concat(extra)}));
const after=evaluate(r2);
const res={evalInputs:evalSet.length,before,collected:r.render.collected.length,retrainedWith:extra.length,after,templateBytesBefore:r.stats.templateBytes,templateBytesAfter:r2.stats.templateBytes,conflictsAfter:r2.stats.conflicts,poisonedAfter:r2.stats.poisoned};
console.log(JSON.stringify(res,null,1));fs.writeFileSync(require("path").join(__dirname, "relearn.json"),JSON.stringify(res,null,1)+"\n");
