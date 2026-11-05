const fs=require("fs");const B="/tmp/opencode/pp-wt/react-bench/react-bench";
const util=require(B+"/harness-util.js"),data=require(B+"/data.js");const {React,ReactDOMServer}=require(B+"/react-deps.js");
const impl=require("../index.js");
const App=require(util.APP_JS_PATH);const out={};
for (const [ts,tl] of [[20,2],[60,10],[200,20]]) {
  const r=impl.build(fs.readFileSync(util.APP_JS_PATH,"utf8"),util.makePrepareOpts({trainSmall:ts,trainLarge:tl}));
  const row={trainSmall:ts,trainLarge:tl,buildMs:Math.round(r.stats.buildMs),templateBytes:r.stats.templateBytes};
  for (const [name,corpus] of [["check500",data.getCheckCorpus()],["small500",data.getSmallCorpus()],["large100",data.getLargeCorpus(100)]]) {
    const f0=r.stats.fallbacks;let bad=0;
    for (const d of corpus) if (r.render(d)!==ReactDOMServer.renderToString(React.createElement(App,{data:d}))) bad++;
    row[name]=`${r.stats.fallbacks-f0}/${corpus.length} fallbacks, ${bad} mismatches`;
  }
  console.log(JSON.stringify(row));
}
