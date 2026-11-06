/** The whole companion UI as one HTML string (vanilla JS + CSS, no external resources). */
export const PAGE_HTML: string = String.raw`<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>prompt-to-store</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%234f46e5'/%3E%3Cpath d='M9 21l7-12 7 12z' fill='white'/%3E%3C/svg%3E">
<style>
:root{
  --bg:#f6f7f9;--surface:#ffffff;--surface2:#f1f3f6;--border:#e3e6eb;--text:#12151a;--muted:#5d6675;
  --accent:#4f46e5;--accent-h:#4338ca;--accent-t:#ffffff;--accent-soft:#eceafd;
  --ok:#0f8a4f;--ok-bg:#e3f6ec;--warn:#a15c00;--warn-bg:#fdf1d9;--err:#c4262e;--err-bg:#fde6e7;--info:#1d63d6;--info-bg:#e5eefc;--idle:#5d6675;--idle-bg:#eceef2;
  --shadow:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06);--radius:12px;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0b0d10;--surface:#13161b;--surface2:#1a1e25;--border:#262b34;--text:#eceff4;--muted:#98a2b3;
  --accent:#8b83ff;--accent-h:#a39dff;--accent-t:#0b0d10;--accent-soft:#23214a;
  --ok:#3ddc97;--ok-bg:#10281e;--warn:#f5b84a;--warn-bg:#2d2310;--err:#ff7b82;--err-bg:#331518;--info:#6aa6ff;--info-bg:#152238;--idle:#98a2b3;--idle-bg:#1f242c;
  --shadow:0 1px 2px rgba(0,0,0,.4);
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic","Noto Naskh Arabic",Tahoma,sans-serif;-webkit-font-smoothing:antialiased}
button,input,textarea{font:inherit;color:inherit}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.mono{font-family:var(--mono);font-size:12.5px}
header.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;padding:10px 20px;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;letter-spacing:-.01em}
.logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#4338ca);display:grid;place-items:center;flex:none}
.logo svg{width:16px;height:16px;fill:#fff}
.proj{min-width:0;display:flex;flex-direction:column;line-height:1.2;padding-inline-start:14px;border-inline-start:1px solid var(--border)}
.proj b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proj span{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.spacer{flex:1}
.live{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);padding:5px 10px;border:1px solid var(--border);border-radius:999px;background:var(--surface)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--idle)}
.live.on .dot{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 25%,transparent)}
.live.off .dot{background:var(--err)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-weight:550;line-height:1.2;transition:background .12s,border-color .12s,transform .05s}
.btn:hover{background:var(--surface2)}.btn:active{transform:translateY(1px)}
.btn:focus-visible,.nav a:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-t)}.btn.primary:hover{background:var(--accent-h)}
.btn.danger{color:var(--err);border-color:color-mix(in srgb,var(--err) 40%,var(--border))}.btn.danger:hover{background:var(--err-bg)}
.btn.big{padding:13px 26px;font-size:16px;border-radius:11px}
.btn[disabled]{opacity:.55;cursor:not-allowed}
.btn.sm{padding:5px 10px;font-size:13px}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:28px;max-width:1180px;margin:0 auto;padding:24px 20px 60px}
.nav{position:sticky;top:76px;align-self:start;display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:9px;color:var(--muted);font-weight:550}
.nav a:hover{background:var(--surface2);text-decoration:none;color:var(--text)}
.nav a.active{background:var(--accent-soft);color:var(--accent)}
.nav svg{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.nav .count{margin-inline-start:auto;background:var(--warn-bg);color:var(--warn);border-radius:999px;padding:0 7px;font-size:12px;font-weight:650}
main{min-width:0}
h1{font-size:22px;letter-spacing:-.02em;margin:0 0 4px}
h2{font-size:16px;margin:0 0 10px;letter-spacing:-.01em}
.sub{color:var(--muted);margin:0 0 20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px;margin-bottom:16px}
.card.hl{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.row.between{justify-content:space-between}
.stack>*+*{margin-top:10px}
.muted{color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;background:var(--idle-bg);color:var(--idle)}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.ok{background:var(--ok-bg);color:var(--ok)}.badge.warn{background:var(--warn-bg);color:var(--warn)}
.badge.err{background:var(--err-bg);color:var(--err)}.badge.info{background:var(--info-bg);color:var(--info)}
.badge.info::before{animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.25}}
.stages{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}
.stage{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.stage::before{content:"";position:absolute;inset-inline:0;top:0;height:3px;background:var(--idle-bg)}
.stage.ok::before{background:var(--ok)}.stage.info::before{background:var(--info)}.stage.warn::before{background:var(--warn)}.stage.err::before{background:var(--err)}
.stage .n{width:24px;height:24px;border-radius:7px;background:var(--surface2);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px}
.stage.ok .n{background:var(--ok-bg);color:var(--ok)}
.stage h3{margin:0 0 6px;font-size:15px}
.stage p{margin:8px 0 0;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.hint{display:flex;gap:12px;align-items:flex-start;background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);border-radius:var(--radius);padding:14px 16px;margin-bottom:16px}
.hint svg{width:20px;height:20px;flex:none;stroke:var(--accent);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-top:2px}
.hint b{display:block;color:var(--accent)}
.list{margin:0;padding:0;list-style:none}
.list li{padding:9px 0;border-top:1px solid var(--border)}.list li:first-child{border-top:0}
.screens{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.screens div{background:var(--surface2);border-radius:10px;padding:10px 12px}
.screens b{display:block}.screens span{color:var(--muted);font-size:13px}
.svc{display:grid;gap:14px}
.svc-head{display:flex;gap:12px;align-items:center}
.svc-ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:700;flex:none}
.svc-head h2{margin:0}
ol.steps{margin:6px 0 0;padding-inline-start:22px;color:var(--text)}
ol.steps li{margin:5px 0;padding-inline-start:4px}
ol.steps li::marker{color:var(--muted);font-weight:600}
code,.kbd{unicode-bidi:isolate;font-family:var(--mono);font-size:12.5px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:0 5px}
.form{display:grid;gap:12px;margin-top:6px;padding-top:14px;border-top:1px dashed var(--border)}
label.f{display:grid;gap:5px;font-weight:550;font-size:13.5px}
input[type=password],input[type=text],textarea{width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--border);background:var(--bg);font-weight:400;font-family:var(--mono);font-size:13px}
textarea{resize:vertical;min-height:64px}
.file{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.file input[type=file]{display:none}
.result{padding:10px 12px;border-radius:9px;font-size:13.5px}
.result.ok{background:var(--ok-bg);color:var(--ok)}.result.err{background:var(--err-bg);color:var(--err);overflow-wrap:anywhere}
.result dl{margin:6px 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 12px}.result dt{opacity:.8}.result dd{margin:0;overflow-wrap:anywhere}
.privacy{display:flex;gap:10px;align-items:center;color:var(--muted);font-size:13px;background:var(--surface2);border-radius:9px;padding:9px 12px}
.privacy svg{width:16px;height:16px;flex:none;stroke:var(--ok);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
details{border-top:1px solid var(--border);padding:8px 0}details:first-child{border-top:0}
summary{cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none;padding:2px 0}
summary::-webkit-details-marker{display:none}
summary .chev{width:14px;height:14px;stroke:var(--muted);fill:none;stroke-width:2;transition:transform .15s;flex:none}
details[open] summary .chev{transform:rotate(90deg)}
[dir=rtl] summary .chev{transform:scaleX(-1)}[dir=rtl] details[open] summary .chev{transform:scaleX(-1) rotate(90deg)}
summary .t{font-weight:600}summary .s{color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.det{margin:8px 0 4px;padding:10px 12px;background:var(--surface2);border-radius:9px;font-family:var(--mono);font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.gallery{display:flex;gap:18px;overflow-x:auto;padding:8px 4px 16px}
.phone{flex:none;width:200px;border-radius:30px;border:7px solid #1b1d22;background:#1b1d22;box-shadow:0 8px 24px rgba(0,0,0,.2);position:relative}
.phone::before{content:"";position:absolute;top:6px;left:50%;width:54px;height:6px;border-radius:6px;background:#000;transform:translateX(-50%);z-index:1}
.phone img{display:block;width:100%;border-radius:22px;background:#fff;aspect-ratio:9/19}
.phone figcaption{color:#aab;text-align:center;font-size:11px;padding:4px 0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.phone{margin:0}
.build{display:grid;gap:12px}
.install{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:6px;padding:14px;background:var(--surface2);border-radius:10px}
.qr{width:132px;height:132px;background:#fff;border-radius:10px;padding:4px;flex:none}
.qr img{width:100%;height:100%;display:block}
.pay,.det,input[type=password],textarea{direction:ltr;text-align:left}
.pay{margin:10px 0;padding:10px 12px;background:var(--surface2);border-radius:9px;font-family:var(--mono);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.log{font-family:var(--mono);font-size:12.5px}
.log .e{display:grid;grid-template-columns:150px 72px 70px minmax(0,1fr);gap:10px;padding:7px 4px;border-top:1px solid var(--border);align-items:baseline}
.log .e:first-child{border-top:0}.log .tm{color:var(--muted)}.log .src{color:var(--muted)}
.log .lv{font-weight:700;text-transform:uppercase;font-size:11px}
.lv.info{color:var(--info)}.lv.success{color:var(--ok)}.lv.warn{color:var(--warn)}.lv.error{color:var(--err)}
.log .msg{overflow-wrap:anywhere;white-space:pre-wrap}
.empty{text-align:center;color:var(--muted);padding:34px 10px}
.toast{position:fixed;bottom:22px;inset-inline-start:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:50;font-weight:550;max-width:90vw}
[dir=rtl] .toast{transform:translateX(50%)}
.fatal{max-width:520px;margin:12vh auto;text-align:center}
@media (max-width:900px){.stages{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){
  header.top{padding:8px 14px;gap:10px;flex-wrap:wrap}
  .proj{padding-inline-start:10px}.live .lbl{display:none}
  .layout{display:block;padding:0 14px 40px}
  .nav{position:sticky;top:53px;z-index:15;flex-direction:row;overflow-x:auto;background:var(--bg);margin:0 -14px 16px;padding:8px 14px;border-bottom:1px solid var(--border);gap:4px}
  .nav a{padding:7px 11px;white-space:nowrap}
  .log .e{grid-template-columns:1fr auto;grid-template-areas:"lv tm" "msg msg"}
  .log .e .src{display:none}.log .e .lv{grid-area:lv}.log .e .tm{grid-area:tm;text-align:end}.log .e .msg{grid-area:msg}
}
@media (max-width:420px){.stages{grid-template-columns:1fr}.brand span{display:none}}
</style>
</head>
<body>
<header class="top">
  <div class="brand"><div class="logo"><svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z"/></svg></div><span>prompt-to-store</span></div>
  <div class="proj" id="proj"></div>
  <div class="spacer"></div>
  <div class="live" id="live"><span class="dot"></span><span class="lbl" id="livelbl"></span></div>
  <button class="btn sm" id="langbtn" type="button"></button>
</header>
<div class="layout">
  <nav class="nav" id="nav"></nav>
  <main id="main"></main>
</div>
<div id="toasts"></div>
<script>
(function(){
"use strict";
var SERVICES=["codemagic","github","play","appstore"];
var STAGES=["plan","build","check","ship","store"];
var FIELDS={
  codemagic:[{f:"token",kind:"password",l:"f_cm_token"}],
  github:[{f:"token",kind:"password",l:"f_gh_token"}],
  play:[{f:"serviceAccountJson",kind:"file",l:"f_play_json",accept:".json,application/json"}],
  appstore:[{f:"issuerId",kind:"text",l:"f_asc_issuer"},{f:"keyId",kind:"text",l:"f_asc_key"},{f:"privateKey",kind:"file",l:"f_asc_p8",accept:".p8,.pem,.txt"}]
};
var COLORS={codemagic:"#e5484d",github:"#24292f",play:"#0b8f5f",appstore:"#1d6fe0"};
var L={
en:{
 dir:"ltr",lang:"العربية",
 nav_path:"Path",nav_connections:"Connections & keys",nav_check:"Check",nav_builds:"Builds",nav_store:"Store",nav_log:"Log",
 live:"Live",offline:"Reconnecting...",
 s_plan:"Plan",s_build:"Build",s_check:"Check",s_ship:"Ship",s_store:"Store",
 st_pending:"Pending",st_in_progress:"In progress",st_awaiting_approval:"Awaiting approval",st_done:"Done",st_failed:"Failed",st_blocked:"Blocked",
 b_queued:"Queued",b_preparing:"Preparing",b_building:"Building",b_testing:"Testing",b_publishing:"Publishing",b_finishing:"Finishing",b_finished:"Finished",b_failed:"Failed",b_canceled:"Canceled",b_timeout:"Timed out",b_skipped:"Skipped",b_unknown:"Unknown",
 c_passed:"Passed",c_failed:"Failed",c_warning:"Warning",c_skipped:"Skipped",
 a_pending:"Waiting for you",a_approved:"Approved",a_rejected:"Rejected",a_consumed:"Done",
 path_title:"Your app's path",path_sub:"From idea to the stores. Your agent does the work; you stay in control.",
 next:"Next step",
 h_plan:"Ask your agent to plan your app. The plan will appear here for your approval.",
 h_approve:"Review the plan below, then press Approve to let your agent start building.",
 h_connect:"Connect Codemagic so your agent can build your app in the cloud.",
 h_build:"Plan approved. Your agent is writing the app; tell it to build and check it.",
 h_check:"Waiting for checks and screenshots. Ask your agent to run the check.",
 h_ship:"Checks passed. Ask your agent to ship a test build to your phone.",
 h_store:"Test build is ready. Ask your agent to prepare the store listing.",
 h_publish:"A publish request is waiting for your confirmation.",
 h_done:"Everything is done. Nice work.",
 h_failed:"A stage failed. Open the Log to see why and tell your agent.",
 go_connect:"Connect now",go_store:"Review",
 plan:"Plan",no_plan:"No plan yet.",screens:"Screens",decisions:"Decisions",approve:"Approve plan",approved_on:"Approved",approved_ui:"in this app",approved_chat:"in chat",
 conn_title:"Connections & keys",conn_sub:"Enter your keys here, never in chat with your agent.",
 privacy:"Your key stays on this computer. It is verified once, then stored in your system keychain or a private file in this project, and never sent to your agent.",
 connected:"Connected",not_connected:"Not connected",verified:"Verified",connect:"Verify & connect",disconnect:"Disconnect",verifying:"Verifying...",
 stored_in:"Stored in",choose_file:"Choose file",file_loaded:"File loaded",or_paste:"...or paste the contents",
 f_cm_token:"Codemagic API token",f_gh_token:"GitHub token",f_play_json:"Service account JSON key",f_asc_issuer:"Issuer ID",f_asc_key:"Key ID",f_asc_p8:"Private key (.p8)",
 ok_connected:"Connected successfully",
 svc_codemagic:"Codemagic",svc_github:"GitHub",svc_play:"Google Play",svc_appstore:"App Store Connect",
 svc_codemagic_d:"Builds your app in the cloud (Android and iOS).",svc_github_d:"Stores your source code.",svc_play_d:"Publishes to Google Play.",svc_appstore_d:"Publishes to the App Store and TestFlight.",
 steps_codemagic:["Open <codemagic.io> and sign in.","Go to <Teams> then <Personal Account> then <Integrations>.","Under <Codemagic API>, click <Show>.","Copy the token and paste it below."],
 steps_github:["Open <github.com> then your avatar then <Settings> then <Developer settings>.","Choose <Personal access tokens> then <Fine-grained tokens> then <Generate new token>.","Give it <Contents: Read and write> and <Administration: Read and write> (to create the repository). Or use a classic token with the <repo> scope.","Copy the token (shown once) and paste it below."],
 steps_play:["Open the <Google Cloud Console> then <IAM & Admin> then <Service accounts> and create a service account.","Open it, then <Keys> then <Add key> then <Create new key> then <JSON>. A file downloads.","In <Play Console> go to <Users and permissions> then <Invite new users>, and enter the service account email.","Give it permission to release apps (release to production and testing tracks), then send the invite.","Choose the downloaded JSON file below."],
 steps_appstore:["Open <App Store Connect> then <Users and Access> then <Integrations> then <App Store Connect API>.","Under <Team Keys> click <Generate API Key>, give it the <App Manager> role.","Download the <.p8> file (only possible once).","Copy the <Key ID> from the key row and the <Issuer ID> from the top of the page.","Fill in both IDs below and choose the .p8 file."],
 check_title:"Checks",check_sub:"Results from the last check run and what your app looks like.",no_check:"No checks have run yet.",last_run:"Last run",all_passed:"All checks passed",some_failed:"Some checks failed",screenshots:"Screenshots",no_shots:"No screenshots yet.",
 builds_title:"Builds",builds_sub:"Cloud builds of your app.",no_builds:"No builds yet.",open_build:"Open in Codemagic",artifacts:"Artifacts",install_phone:"Install on your phone",scan:"Scan with your phone's camera, then download and install.",open_link:"Open link",
 store_title:"Store",store_sub:"Nothing is published to a store until you press Publish here.",no_pending:"Nothing is waiting for your approval.",publish:"Publish",reject:"Reject",payload:"Details",history:"Earlier requests",store_conn:"Store connections",
 confirm_publish:"Publish now? This sends your app to the store.",
 log_title:"Activity log",log_sub:"Everything that happened in this project, newest first.",no_log:"No activity yet.",
 expired:"Session expired or invalid link. Open the link from your agent or from the terminal again.",
 err_generic:"Something went wrong",copy_failed:"Failed",done:"Done",
 stage_ship:"Ship"
},
ar:{
 dir:"rtl",lang:"English",
 nav_path:"المسار",nav_connections:"الاتصالات والمفاتيح",nav_check:"الفحص",nav_builds:"البناءات",nav_store:"المتجر",nav_log:"السجل",
 live:"مباشر",offline:"جارٍ إعادة الاتصال...",
 s_plan:"التخطيط",s_build:"البناء",s_check:"الفحص",s_ship:"الشحن",s_store:"المتجر",
 st_pending:"في الانتظار",st_in_progress:"قيد التنفيذ",st_awaiting_approval:"بانتظار موافقتك",st_done:"تم",st_failed:"فشل",st_blocked:"متوقف",
 b_queued:"في الطابور",b_preparing:"قيد التحضير",b_building:"قيد البناء",b_testing:"قيد الاختبار",b_publishing:"قيد النشر",b_finishing:"على وشك الانتهاء",b_finished:"اكتمل",b_failed:"فشل",b_canceled:"أُلغي",b_timeout:"انتهت المهلة",b_skipped:"تم تخطيه",b_unknown:"غير معروف",
 c_passed:"نجح",c_failed:"فشل",c_warning:"تنبيه",c_skipped:"تم تخطيه",
 a_pending:"بانتظارك",a_approved:"تمت الموافقة",a_rejected:"مرفوض",a_consumed:"تم",
 path_title:"مسار تطبيقك",path_sub:"من الفكرة إلى المتاجر. وكيلك ينفّذ العمل وأنت تبقى المتحكم.",
 next:"الخطوة التالية",
 h_plan:"اطلب من وكيلك أن يخطط لتطبيقك. ستظهر الخطة هنا لتوافق عليها.",
 h_approve:"راجع الخطة أدناه ثم اضغط موافقة ليبدأ وكيلك البناء.",
 h_connect:"اربط Codemagic ليتمكن وكيلك من بناء تطبيقك في السحابة.",
 h_build:"تمت الموافقة على الخطة. وكيلك يكتب التطبيق الآن؛ اطلب منه البناء والفحص.",
 h_check:"بانتظار الفحص ولقطات الشاشة. اطلب من وكيلك تشغيل الفحص.",
 h_ship:"نجح الفحص. اطلب من وكيلك شحن نسخة تجريبية إلى هاتفك.",
 h_store:"النسخة التجريبية جاهزة. اطلب من وكيلك تجهيز صفحة المتجر.",
 h_publish:"يوجد طلب نشر ينتظر تأكيدك.",
 h_done:"اكتمل كل شيء. عمل رائع.",
 h_failed:"فشلت إحدى المراحل. افتح السجل لمعرفة السبب وأخبر وكيلك.",
 go_connect:"اربط الآن",go_store:"مراجعة",
 plan:"الخطة",no_plan:"لا توجد خطة بعد.",screens:"الشاشات",decisions:"القرارات",approve:"الموافقة على الخطة",approved_on:"تمت الموافقة",approved_ui:"من هذا التطبيق",approved_chat:"من المحادثة",
 conn_title:"الاتصالات والمفاتيح",conn_sub:"أدخل مفاتيحك هنا، وليس في المحادثة مع وكيلك.",
 privacy:"مفتاحك يبقى على هذا الجهاز. يُتحقق منه مرة واحدة ثم يُحفظ في سلسلة مفاتيح النظام أو ملف خاص داخل المشروع، ولا يُرسل أبداً إلى وكيلك.",
 connected:"متصل",not_connected:"غير متصل",verified:"تم التحقق",connect:"تحقق واتصل",disconnect:"قطع الاتصال",verifying:"جارٍ التحقق...",
 stored_in:"مخزّن في",choose_file:"اختر ملفاً",file_loaded:"تم تحميل الملف",or_paste:"...أو الصق المحتوى",
 f_cm_token:"رمز Codemagic API",f_gh_token:"رمز GitHub",f_play_json:"مفتاح حساب الخدمة (JSON)",f_asc_issuer:"Issuer ID",f_asc_key:"Key ID",f_asc_p8:"المفتاح الخاص (.p8)",
 ok_connected:"تم الاتصال بنجاح",
 svc_codemagic:"Codemagic",svc_github:"GitHub",svc_play:"Google Play",svc_appstore:"App Store Connect",
 svc_codemagic_d:"يبني تطبيقك في السحابة (أندرويد وiOS).",svc_github_d:"يحفظ الشيفرة المصدرية.",svc_play_d:"النشر على Google Play.",svc_appstore_d:"النشر على App Store وTestFlight.",
 steps_codemagic:["افتح <codemagic.io> وسجّل الدخول.","اذهب إلى <Teams> ثم <Personal Account> ثم <Integrations>.","تحت <Codemagic API> اضغط <Show>.","انسخ الرمز والصقه أدناه."],
 steps_github:["افتح <github.com> ثم صورتك ثم <Settings> ثم <Developer settings>.","اختر <Personal access tokens> ثم <Fine-grained tokens> ثم <Generate new token>.","امنحه <Contents: Read and write> و<Administration: Read and write> (لإنشاء المستودع). أو استخدم رمزاً كلاسيكياً بصلاحية <repo>.","انسخ الرمز (يظهر مرة واحدة) والصقه أدناه."],
 steps_play:["افتح <Google Cloud Console> ثم <IAM & Admin> ثم <Service accounts> وأنشئ حساب خدمة.","افتحه ثم <Keys> ثم <Add key> ثم <Create new key> ثم <JSON>. سيُنزَّل ملف.","في <Play Console> اذهب إلى <Users and permissions> ثم <Invite new users> وأدخل بريد حساب الخدمة.","امنحه صلاحية إصدار التطبيقات (الإنتاج ومسارات الاختبار) ثم أرسل الدعوة.","اختر ملف JSON الذي نزّلته أدناه."],
 steps_appstore:["افتح <App Store Connect> ثم <Users and Access> ثم <Integrations> ثم <App Store Connect API>.","تحت <Team Keys> اضغط <Generate API Key> وامنحه دور <App Manager>.","نزّل ملف <.p8> (متاح مرة واحدة فقط).","انسخ <Key ID> من صف المفتاح و<Issuer ID> من أعلى الصفحة.","املأ المعرّفين أدناه واختر ملف .p8."],
 check_title:"الفحص",check_sub:"نتائج آخر فحص وشكل تطبيقك.",no_check:"لم يُجرَ أي فحص بعد.",last_run:"آخر تشغيل",all_passed:"نجحت كل الفحوصات",some_failed:"فشلت بعض الفحوصات",screenshots:"لقطات الشاشة",no_shots:"لا توجد لقطات بعد.",
 builds_title:"البناءات",builds_sub:"بناءات تطبيقك في السحابة.",no_builds:"لا توجد بناءات بعد.",open_build:"افتح في Codemagic",artifacts:"الملفات الناتجة",install_phone:"ثبّت على هاتفك",scan:"امسح الرمز بكاميرا هاتفك ثم نزّل وثبّت.",open_link:"افتح الرابط",
 store_title:"المتجر",store_sub:"لا يُنشر شيء في أي متجر حتى تضغط نشر هنا.",no_pending:"لا شيء بانتظار موافقتك.",publish:"نشر",reject:"رفض",payload:"التفاصيل",history:"طلبات سابقة",store_conn:"اتصالات المتاجر",
 confirm_publish:"هل تريد النشر الآن؟ سيُرسل تطبيقك إلى المتجر.",
 log_title:"سجل النشاط",log_sub:"كل ما حدث في هذا المشروع، الأحدث أولاً.",no_log:"لا يوجد نشاط بعد.",
 expired:"انتهت الجلسة أو الرابط غير صالح. افتح الرابط من وكيلك أو من الطرفية مرة أخرى.",
 err_generic:"حدث خطأ",copy_failed:"فشل",done:"تم"
}};
var lang="en";
try{var sl=localStorage.getItem("p2s_lang");if(sl==="ar"||sl==="en")lang=sl;else if((navigator.language||"").toLowerCase().indexOf("ar")===0)lang="ar";}catch(e){}
function t(k){var v=L[lang][k];if(v===undefined)v=L.en[k];return v===undefined?k:v;}

var ICONS={
 path:'<svg viewBox="0 0 24 24"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h6a4 4 0 010 8h-2a4 4 0 000 8"/></svg>',
 keys:'<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>',
 check:'<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>',
 builds:'<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
 store:'<svg viewBox="0 0 24 24"><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0A2.7 2.7 0 0020 9M10 20v-6h4v6"/></svg>',
 log:'<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
 bulb:'<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/></svg>',
 lock:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
 chev:'<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
function icon(n){var s=document.createElement("span");s.style.display="contents";s.innerHTML=ICONS[n];return s;}

function add(e,c){if(c==null||c===false)return;if(Array.isArray(c)){c.forEach(function(x){add(e,x);});}else if(c.nodeType){e.appendChild(c);}else{e.appendChild(document.createTextNode(String(c)));}}
function h(tag,p){var e=document.createElement(tag);p=p||{};for(var k in p){var v=p[k];if(v==null||v===false)continue;if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k==="value")e.value=v;else if(k.slice(0,2)==="on")e.addEventListener(k.slice(2),v);else e.setAttribute(k,v===true?"":v);}for(var i=2;i<arguments.length;i++)add(e,arguments[i]);return e;}
/* Instruction strings use <x> to mark UI labels; build code nodes without innerHTML. */
function rich(s){var f=document.createDocumentFragment();var parts=s.split(/(<[^>]+>)/);parts.forEach(function(p){if(!p)return;if(p.charAt(0)==="<"&&p.charAt(p.length-1)===">")f.appendChild(h("code",{text:p.slice(1,-1)}));else f.appendChild(document.createTextNode(p));});return f;}

/* ---- token / api ---- */
var token="";
try{var q=new URLSearchParams(location.search).get("t");if(q){token=q;sessionStorage.setItem("p2s_t",q);}else token=sessionStorage.getItem("p2s_t")||"";}catch(e){}
function api(path,opts){opts=opts||{};var hd={"content-type":"application/json"};if(token)hd["x-p2s-token"]=token;return fetch(path,{method:opts.method||"GET",headers:hd,body:opts.body?JSON.stringify(opts.body):undefined,credentials:"same-origin"}).then(function(r){if(r.status===401){fatal();throw new Error("401");}return r.json();});}
function fatal(){var m=document.getElementById("main");m.textContent="";m.appendChild(h("div",{class:"card fatal"},h("h2",{text:"prompt-to-store"}),h("p",{class:"muted",text:t("expired")})));}

/* ---- state ---- */
var S=null,live=false,drafts={},results={},busy={};
function route(){var p=location.pathname;if(p.indexOf("/connect/")===0)return{name:"connect",service:p.slice(9)};if(p==="/store")return{name:"store"};if(p==="/builds")return{name:"builds"};if(p==="/check")return{name:"check"};if(p==="/log")return{name:"log"};return{name:"path"};}
function navTo(p){history.pushState(null,"",p);render(true);window.scrollTo(0,0);}
function fmtTime(iso){try{return new Date(iso).toLocaleString(lang==="ar"?"ar":undefined,{dateStyle:"medium",timeStyle:"short"});}catch(e){return iso||"";}}
function fmtClock(iso){try{return new Date(iso).toLocaleTimeString(lang==="ar"?"ar":undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch(e){return iso||"";}}
function fmtDay(iso){try{return new Date(iso).toLocaleDateString(lang==="ar"?"ar":undefined,{month:"short",day:"numeric"});}catch(e){return "";}}
function toast(msg){var el=h("div",{class:"toast",role:"status",text:msg});document.body.appendChild(el);setTimeout(function(){el.remove();},3200);}

var STATUS_TONE={pending:"",in_progress:"info",awaiting_approval:"warn",done:"ok",failed:"err",blocked:"err",passed:"ok",warning:"warn",skipped:"",
 queued:"info",preparing:"info",building:"info",testing:"info",publishing:"info",finishing:"info",finished:"ok",canceled:"",timeout:"err",unknown:"",approved:"ok",rejected:"err",consumed:"ok"};
function badge(text,tone){return h("span",{class:"badge "+(tone||"")},text);}
function stageBadge(st){return badge(t("st_"+st),STATUS_TONE[st]);}

/* ---- views ---- */
function pageHead(title,sub){return [h("h1",{text:title}),h("p",{class:"sub",text:sub})];}

function nextHint(){
 var s=S,pend=s.approvals.filter(function(a){return a.status==="pending";});
 if(pend.length)return{k:"h_publish",go:["/store?approval="+pend[0].id,t("go_store")]};
 if(!s.plan.summary)return{k:"h_plan"};
 if(!s.plan.approved)return{k:"h_approve"};
 var failed=STAGES.filter(function(x){return s.stages[x].status==="failed"||s.stages[x].status==="blocked";});
 if(failed.length)return{k:"h_failed",go:["/log",t("nav_log")]};
 if(s.stages.build.status!=="done"){ if(!s.connections.codemagic.connected)return{k:"h_connect",go:["/connect/codemagic",t("go_connect")]}; return{k:"h_build"}; }
 if(s.stages.check.status!=="done")return{k:"h_check"};
 if(s.stages.ship.status!=="done")return{k:"h_ship"};
 if(s.stages.store.status!=="done")return{k:"h_store"};
 return{k:"h_done"};
}

function viewPath(){
 var s=S,hint=nextHint(),out=[];
 out.push(pageHead(t("path_title"),t("path_sub")));
 var hb=h("div",{class:"hint"},icon("bulb"),h("div",{style:"flex:1"},h("b",{text:t("next")}),h("span",{text:t(hint.k)})));
 if(hint.go)hb.appendChild(h("a",{class:"btn sm",href:hint.go[0],onclick:linkClick},hint.go[1]));
 out.push(hb);
 var grid=h("div",{class:"stages"});
 STAGES.forEach(function(name,i){var st=s.stages[name];grid.appendChild(h("div",{class:"stage "+(STATUS_TONE[st.status]||"")},h("div",{class:"n",text:String(i+1)}),h("h3",{text:t("s_"+name)}),stageBadge(st.status),st.note?h("p",{text:st.note}):null));});
 out.push(grid);
 var card=h("div",{class:"card"});
 card.appendChild(h("div",{class:"row between"},h("h2",{text:t("plan")}),s.plan.approved?badge(t("approved_on")+(s.plan.approvedVia?" ("+t(s.plan.approvedVia==="ui"?"approved_ui":"approved_chat")+")":""),"ok"):(s.plan.summary?badge(t("st_awaiting_approval"),"warn"):null)));
 if(!s.plan.summary){card.appendChild(h("p",{class:"muted",text:t("no_plan")}));}
 else{
  card.appendChild(h("p",{text:s.plan.summary,style:"margin-top:0"}));
  if(s.plan.screens.length){card.appendChild(h("h2",{text:t("screens"),style:"margin-top:16px"}));var g=h("div",{class:"screens"});s.plan.screens.forEach(function(sc){g.appendChild(h("div",null,h("b",{text:sc.name}),h("span",{text:sc.purpose})));});card.appendChild(g);}
  if(s.plan.decisions.length){card.appendChild(h("h2",{text:t("decisions"),style:"margin-top:16px"}));var ul=h("ul",{class:"list"});s.plan.decisions.forEach(function(d){ul.appendChild(h("li",{text:d}));});card.appendChild(ul);}
  if(!s.plan.approved){var b=h("button",{class:"btn primary big",type:"button",style:"margin-top:16px",onclick:function(){b.disabled=true;api("/api/plan/approve",{method:"POST",body:{}}).then(function(r){if(!r.ok)toast(r.error||t("err_generic"));}).catch(function(){});}},t("approve"));card.appendChild(b);}
 }
 out.push(card);
 return out;
}

function svcDetails(d){var keys=Object.keys(d||{});if(!keys.length)return null;var dl=h("dl");keys.forEach(function(k){dl.appendChild(h("dt",{text:k}));dl.appendChild(h("dd",{text:d[k]}));});return dl;}

function viewConnections(focus){
 var out=[];
 out.push(pageHead(t("conn_title"),t("conn_sub")));
 out.push(h("div",{class:"privacy",style:"margin-bottom:16px"},icon("lock"),h("span",{text:t("privacy")})));
 SERVICES.forEach(function(sv){out.push(serviceCard(sv,focus===sv));});
 return out;
}
function serviceCard(sv,focus){
 var c=S.connections[sv],connected=c.connected&&S.hasSecret[sv];
 var card=h("div",{class:"card svc"+(focus?" hl":""),id:"svc-"+sv});
 card.appendChild(h("div",{class:"svc-head"},h("div",{class:"svc-ic",style:"background:"+COLORS[sv],text:t("svc_"+sv).charAt(0)}),h("div",{style:"flex:1;min-width:0"},h("h2",{text:t("svc_"+sv)}),h("div",{class:"muted",text:t("svc_"+sv+"_d")})),badge(connected?t("connected"):t("not_connected"),connected?"ok":"")));
 if(connected){
  var box=h("div",{class:"result ok"},t("verified")+(c.verifiedAt?" · "+fmtTime(c.verifiedAt):""));
  var dl=svcDetails(c.details);if(dl)box.appendChild(dl);
  card.appendChild(box);
  card.appendChild(h("div",{class:"muted",style:"font-size:13px",text:t("stored_in")+": "+(S.secretsBackend==="keychain"?"Keychain":"private file (.prompt-to-store/secrets.json)")}));
  card.appendChild(h("div",{class:"row"},h("button",{class:"btn danger",type:"button",onclick:function(){api("/api/disconnect/"+sv,{method:"POST",body:{}}).catch(function(){});}},t("disconnect"))));
  return card;
 }
 var ol=h("ol",{class:"steps"});(L[lang]["steps_"+sv]||L.en["steps_"+sv]).forEach(function(s){ol.appendChild(h("li",null,rich(s)));});
 card.appendChild(ol);
 var form=h("form",{class:"form",autocomplete:"off",onsubmit:function(ev){ev.preventDefault();submitConnect(sv);}});
 var d=drafts[sv]=drafts[sv]||{};
 FIELDS[sv].forEach(function(fd){
  var lab=h("label",{class:"f"},h("span",{text:t(fd.l)}));
  if(fd.kind==="file"){
   var fi=h("input",{type:"file",accept:fd.accept,onchange:function(ev){var f=ev.target.files[0];if(!f)return;if(f.size>500000){toast(t("err_generic"));return;}var r=new FileReader();r.onload=function(){d[fd.f]=String(r.result);d[fd.f+"__name"]=f.name;ta.value="";status.textContent=t("file_loaded")+": "+f.name;};r.readAsText(f);}});
   var status=h("span",{class:"muted",text:d[fd.f+"__name"]?t("file_loaded")+": "+d[fd.f+"__name"]:""});
   var pick=h("button",{class:"btn",type:"button",onclick:function(){fi.click();}},t("choose_file"));
   var ta=h("textarea",{rows:"3",placeholder:t("or_paste"),spellcheck:"false",autocomplete:"off",oninput:function(){d[fd.f]=ta.value;d[fd.f+"__name"]="";status.textContent="";}});
   lab.appendChild(h("div",{class:"file"},pick,fi,status));lab.appendChild(ta);
  }else{
   var inp=h("input",{type:fd.kind,autocomplete:"off",spellcheck:"false",value:d[fd.f]||"",oninput:function(ev){d[fd.f]=ev.target.value;}});
   lab.appendChild(inp);
  }
  form.appendChild(lab);
 });
 var res=results[sv];
 if(res){form.appendChild(res.ok?h("div",{class:"result ok"},t("ok_connected")):h("div",{class:"result err",role:"alert",text:res.error||t("err_generic")}));}
 var isBusy=!!busy[sv];
 form.appendChild(h("div",{class:"row"},h("button",{class:"btn primary",type:"submit",disabled:isBusy},isBusy?t("verifying"):t("connect"))));
 card.appendChild(form);
 return card;
}
function submitConnect(sv){
 var d=drafts[sv]||{},body={};FIELDS[sv].forEach(function(fd){body[fd.f]=d[fd.f]||"";});
 busy[sv]=true;delete results[sv];render(true);
 api("/api/connect/"+sv,{method:"POST",body:body}).then(function(r){busy[sv]=false;results[sv]=r;if(r.ok){drafts[sv]={};}render(true);}).catch(function(e){busy[sv]=false;results[sv]={ok:false,error:String(e&&e.message||e)};render(true);});
}

function viewCheck(){
 var out=[pageHead(t("check_title"),t("check_sub"))],run=S.checks.length?S.checks[S.checks.length-1]:null;
 if(!run){out.push(h("div",{class:"card empty",text:t("no_check")}));return out;}
 var card=h("div",{class:"card"});
 card.appendChild(h("div",{class:"row between"},h("h2",{text:run.passed?t("all_passed"):t("some_failed"),style:"margin:0"}),badge(run.passed?t("c_passed"):t("c_failed"),run.passed?"ok":"err")));
 card.appendChild(h("div",{class:"muted",style:"margin:4px 0 10px;font-size:13px",text:t("last_run")+": "+fmtTime(run.finishedAt||run.startedAt)}));
 run.items.forEach(function(it){
  var det=h("details",null,h("summary",null,icon("chev"),h("span",{class:"t",text:it.name}),badge(t("c_"+it.status),STATUS_TONE[it.status]),h("span",{class:"s",text:it.summary})));
  det.appendChild(h("div",{class:"det"},[it.summary].concat(it.details||[]).join("\n")+(it.durationMs!=null?"\n("+(it.durationMs/1000).toFixed(1)+"s)":"")));
  if(it.status==="failed")det.open=true;
  card.appendChild(det);
 });
 out.push(card);
 var sc=h("div",{class:"card"});sc.appendChild(h("h2",{text:t("screenshots")}));
 if(!run.screenshots.length)sc.appendChild(h("div",{class:"muted",text:t("no_shots")}));
 else{var g=h("div",{class:"gallery"});run.screenshots.forEach(function(p){var rel=String(p).replace(/^\/+/,"").replace(/^checks\//,"");var src="/files/checks/"+rel.split("/").map(encodeURIComponent).join("/");var name=rel.split("/").pop().replace(/\.png$/i,"");g.appendChild(h("figure",{class:"phone"},h("img",{src:src,alt:name,loading:"lazy"}),h("figcaption",{text:name})));});sc.appendChild(g);}
 out.push(sc);
 return out;
}

function viewBuilds(){
 var out=[pageHead(t("builds_title"),t("builds_sub"))];
 if(!S.builds.length){out.push(h("div",{class:"card empty",text:t("no_builds")}));return out;}
 S.builds.slice().reverse().forEach(function(b){
  var card=h("div",{class:"card build"});
  card.appendChild(h("div",{class:"row between"},h("div",null,h("h2",{style:"margin:0",text:b.workflow+" · "+b.platform+" · "+b.kind}),h("div",{class:"muted mono",text:b.id+" · "+fmtTime(b.startedAt)})),badge(t("b_"+b.status),STATUS_TONE[b.status])));
  if(b.error)card.appendChild(h("div",{class:"result err",text:b.error}));
  if(b.url&&/^https?:\/\//.test(b.url))card.appendChild(h("div",null,h("a",{href:b.url,target:"_blank",rel:"noopener noreferrer",text:t("open_build")+" ↗"})));
  if(b.status==="finished"&&b.artifacts.length){
   b.artifacts.forEach(function(a){
    var link=a.publicUrl||a.url;if(!link||!/^https?:\/\//.test(link))return;
    var box=h("div",{class:"install"},h("div",{class:"qr"},h("img",{src:"/api/qr?data="+encodeURIComponent(link),alt:"QR"})),h("div",{style:"min-width:0;flex:1"},h("b",{text:t("install_phone")}),h("div",{class:"muted",text:a.name+(a.size?" · "+(a.size/1048576).toFixed(1)+" MB":"")}),h("div",{class:"muted",style:"font-size:13px;margin:4px 0 8px",text:t("scan")}),h("a",{class:"btn sm",href:link,target:"_blank",rel:"noopener noreferrer",text:t("open_link")+" ↗"})));
    card.appendChild(box);
   });
  }
  out.push(card);
 });
 return out;
}

function viewStore(){
 var out=[pageHead(t("store_title"),t("store_sub"))],hl=new URLSearchParams(location.search).get("approval");
 var pend=S.approvals.filter(function(a){return a.status==="pending";}),hist=S.approvals.filter(function(a){return a.status!=="pending";}).reverse();
 if(!pend.length)out.push(h("div",{class:"card empty",text:t("no_pending")}));
 pend.forEach(function(a){
  var card=h("div",{class:"card"+(hl===a.id?" hl":""),id:"appr-"+a.id});
  card.appendChild(h("div",{class:"row between"},h("h2",{style:"margin:0",text:a.title}),badge(t("a_pending"),"warn")));
  card.appendChild(h("p",{text:a.summary}));
  if(Object.keys(a.payload||{}).length){card.appendChild(h("div",{class:"muted",style:"font-size:13px",text:t("payload")}));card.appendChild(h("div",{class:"pay",text:JSON.stringify(a.payload,null,2)}));}
  var pub=h("button",{class:"btn primary big",type:"button",onclick:function(){if(!confirm(t("confirm_publish")))return;decide(a.id,"approve",pub);}},t("publish"));
  var rej=h("button",{class:"btn danger big",type:"button",onclick:function(){decide(a.id,"reject",rej);}},t("reject"));
  card.appendChild(h("div",{class:"actions"},pub,rej));
  out.push(card);
 });
 var conn=h("div",{class:"card"});conn.appendChild(h("h2",{text:t("store_conn")}));
 ["play","appstore"].forEach(function(sv){var ok=S.connections[sv].connected&&S.hasSecret[sv];conn.appendChild(h("div",{class:"row between",style:"padding:6px 0"},h("span",{text:t("svc_"+sv)}),ok?badge(t("connected"),"ok"):h("a",{href:"/connect/"+sv,onclick:linkClick,text:t("not_connected")+" → "+t("go_connect")})));});
 out.push(conn);
 if(hist.length){var hc=h("div",{class:"card"});hc.appendChild(h("h2",{text:t("history")}));hist.slice(0,15).forEach(function(a){hc.appendChild(h("div",{class:"row between",style:"padding:6px 0;border-top:1px solid var(--border)"},h("div",null,h("div",{text:a.title,style:"font-weight:550"}),h("div",{class:"muted",style:"font-size:12.5px",text:fmtTime(a.decidedAt||a.createdAt)})),badge(t("a_"+a.status),STATUS_TONE[a.status])));});out.push(hc);}
 return out;
}
function decide(id,decision,btn){btn.disabled=true;api("/api/approvals/"+encodeURIComponent(id),{method:"POST",body:{decision:decision}}).then(function(r){if(!r.ok){toast(r.error||t("err_generic"));btn.disabled=false;}}).catch(function(){btn.disabled=false;});}

function viewLog(){
 var out=[pageHead(t("log_title"),t("log_sub"))];
 if(!S.log.length){out.push(h("div",{class:"card empty",text:t("no_log")}));return out;}
 var card=h("div",{class:"card log"});
 S.log.slice().reverse().slice(0,300).forEach(function(e){card.appendChild(h("div",{class:"e"},h("span",{class:"tm",text:fmtDay(e.at)+" "+fmtClock(e.at)}),h("span",{class:"lv "+e.level,text:e.level}),h("span",{class:"src",text:e.source}),h("span",{class:"msg",text:e.message})));});
 out.push(card);
 return out;
}

/* ---- shell ---- */
var NAV=[["/","path","nav_path"],["/connect/codemagic","keys","nav_connections"],["/check","check","nav_check"],["/builds","builds","nav_builds"],["/store","store","nav_store"],["/log","log","nav_log"]];
function linkClick(ev){if(ev.metaKey||ev.ctrlKey||ev.shiftKey||ev.button!==0)return;ev.preventDefault();navTo(ev.currentTarget.getAttribute("href"));}
function renderNav(){
 var nav=document.getElementById("nav"),r=route();nav.textContent="";
 var pend=S?S.approvals.filter(function(a){return a.status==="pending";}).length:0;
 NAV.forEach(function(n){var active=(n[0]==="/"&&r.name==="path")||(n[0]!=="/"&&(("/"+r.name)===n[0]||(r.name==="connect"&&n[1]==="keys")));
  var a=h("a",{href:n[0],class:active?"active":"",onclick:linkClick,"aria-current":active?"page":null},icon(n[1]),h("span",{text:t(n[2])}));
  if(n[1]==="store"&&pend)a.appendChild(h("span",{class:"count",text:String(pend)}));
  nav.appendChild(a);});
}
function renderHeader(){
 var p=document.getElementById("proj");p.textContent="";
 if(S){var nm=S.project.displayName||S.project.name||"My app";p.appendChild(h("b",{text:nm}));if(S.project.bundleId)p.appendChild(h("span",{class:"mono",text:S.project.bundleId}));}
 var lv=document.getElementById("live");lv.className="live "+(live?"on":"off");document.getElementById("livelbl").textContent=live?t("live"):t("offline");
 document.getElementById("langbtn").textContent=t("lang");
}
function applyLang(){var d=document.documentElement;d.lang=lang;d.dir=L[lang].dir;}
var lastSig="";
function render(force){
 renderHeader();renderNav();
 var main=document.getElementById("main");
 if(!S){main.textContent="";return;}
 var ae=document.activeElement;
 if(!force&&ae&&main.contains(ae)&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"))return;
 var r=route(),views;
 var y=window.scrollY;
 if(r.name==="connect")views=viewConnections(r.service);else if(r.name==="check")views=viewCheck();else if(r.name==="builds")views=viewBuilds();else if(r.name==="store")views=viewStore();else if(r.name==="log")views=viewLog();else views=viewPath();
 main.textContent="";add(main,views);
 var focus=r.name==="connect"?document.getElementById("svc-"+r.service):(r.name==="store"?document.getElementById("appr-"+new URLSearchParams(location.search).get("approval")):null);
 if(focus&&force&&!busy[r.service])focus.scrollIntoView({block:"start"});else window.scrollTo(0,y);
 document.title=(S.project.displayName||S.project.name||"prompt-to-store")+" · prompt-to-store";
}

document.getElementById("langbtn").addEventListener("click",function(){lang=lang==="en"?"ar":"en";try{localStorage.setItem("p2s_lang",lang);}catch(e){}applyLang();render(true);});
window.addEventListener("popstate",function(){render(true);});

/* ---- live updates ---- */
function setState(s){S=s;render(false);}
function loadState(){return api("/api/state").then(setState).catch(function(){});}
function connectSSE(){
 var es=new EventSource("/api/events");
 es.addEventListener("state",function(ev){live=true;try{setState(JSON.parse(ev.data));}catch(e){}});
 es.onopen=function(){live=true;renderHeader();};
 es.onerror=function(){live=false;renderHeader();};
}
applyLang();renderHeader();renderNav();
try{if(new URLSearchParams(location.search).has("t")){var u=new URL(location.href);u.searchParams.delete("t");history.replaceState(null,"",u.pathname+u.search+u.hash);}}catch(e){}
loadState().then(function(){render(true);connectSSE();});
})();
</script>
</body>
</html>
`;
