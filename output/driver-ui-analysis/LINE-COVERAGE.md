# Original-line coverage ledger

Every original line is indexed below. Embedded binary data is decoded and hashed in inventory.json rather than printed as base64. See reference-numbered.txt for the complete readable source and the main analysis for behavioral interpretation.

| Original line | Area | Source context |
|---|---|---|
| 1 | Document metadata | &lt;!DOCTYPE html&gt; |
| 2 | Document metadata | &lt;html lang="en"&gt; |
| 3 | Document metadata | &lt;head&gt; |
| 4 | Document metadata | &lt;meta charset="UTF-8"&gt; |
| 5 | Document metadata | &lt;meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"&gt; |
| 6 | Document metadata | &lt;meta name="theme-color" content="#D92535"&gt; |
| 7 | Document metadata | &lt;meta name="description" content="A responsive, interactive NESAM Driver dashboard prototype with sample trips and earni |
| 8 | Document metadata | &lt;title&gt;NESAM Driver · Complete Driver App UX&lt;/title&gt; |
| 9 | CSS / visual cascade | &lt;style&gt; |
| 10 | CSS / visual cascade | :root{--red:#D92535;--red-dark:#B81C2A;--red-soft:#FFF0F1;--ink:#191A20;--muted:#6E727E;--line:#E9EBEF;--page:#F6F7F9;-- |
| 11 | CSS / visual cascade | *{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font-family:-apple-system,BlinkMacSystemFo |
| 12 | CSS / visual cascade | .app{max-width:1600px;margin:auto;min-height:100vh;display:grid;grid-template-columns:226px minmax(0,1fr)}.sidebar{posit |
| 13 | CSS / visual cascade | .workspace{padding:32px 38px 38px;min-width:0}.topbar{display:flex;justify-content:space-between;align-items:center;gap: |
| 14 | CSS / visual cascade | .page-tabs{display:flex;gap:8px;margin-bottom:23px;flex-wrap:wrap}.pill-button{min-height:38px;padding:8px 15px;font-siz |
| 15 | CSS / visual cascade | dialog{border:0;padding:0;border-radius:20px;width:min(460px,calc(100% - 30px));max-height:88vh;max-height:88dvh;box-sha |
| 16 | CSS / visual cascade | @media(min-width:1450px){.workspace{padding:35px 48px}.metrics{gap:18px}.dashboard-grid{gap:28px}.next-top{padding:24px  |
| 17 | CSS / visual cascade | @media(max-width:1130px){.app{grid-template-columns:190px minmax(0,1fr)}.sidebar{padding:26px 14px 20px}.sidebar .brand{ |
| 18 | CSS / visual cascade | @media(max-width:900px) and (min-width:701px){.app{grid-template-columns:80px minmax(0,1fr)}.sidebar{padding:26px 12px}. |
| 19 | CSS / visual cascade | @media(max-width:700px){.app{display:block}.sidebar{display:none}.workspace{padding:20px 18px 105px}.topbar{margin-botto |
| 20 | CSS / visual cascade | @media(max-width:360px){.workspace{padding-left:13px;padding-right:13px}.preview-note{font-size:8px}.preview-note .tiny- |
| 21 | CSS / visual cascade | @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behav |
| 22 | CSS / visual cascade | .trip-availability{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:12px 18px;margin-bott |
| 23 | CSS / visual cascade | @media print{.sidebar,.bottom-nav,.header-actions,.preview-note,.page-footer,.toast{display:none!important}.app{display: |
| 24 | CSS / visual cascade | Blank separator |
| 25 | CSS / visual cascade | .trip-flow{--nx-red:#d92535;--nx-red-soft:#fff0f1;--nx-ink:#1c1d24;--nx-muted:#747c89;--nx-line:#e7eaf0;--nx-bg:#f6f7f9; |
| 26 | CSS / visual cascade | .trip-flow *{box-sizing:border-box} |
| 27 | CSS / visual cascade | .trip-flow [hidden]{display:none!important} |
| 28 | CSS / visual cascade | .trip-flow h2,.trip-flow h3,.trip-flow p{margin:0} |
| 29 | CSS / visual cascade | .trip-flow button,.trip-flow input,.trip-flow select{font:inherit} |
| 30 | CSS / visual cascade | .trip-flow .nx-phone{width:100%;max-width:414px;min-width:0;background:var(--nx-bg);border:1px solid #e1e5ec;border-radi |
| 31 | CSS / visual cascade | .trip-flow .nx-header{padding:18px 20px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px;back |
| 32 | CSS / visual cascade | .trip-flow .nx-brand{display:flex;align-items:center;gap:8px} |
| 33 | CSS / visual cascade | .trip-flow .nx-logo{width:44px;height:44px;object-fit:contain;display:block;flex-shrink:0} |
| 34 | CSS / visual cascade | .trip-flow .nx-name{font-size:20px;font-weight:800;letter-spacing:1.8px;line-height:1.1;color:var(--nx-red)} |
| 35 | CSS / visual cascade | .trip-flow .nx-driver{font-size:10px;letter-spacing:2px;margin-top:5px;color:var(--nx-muted)} |
| 36 | CSS / visual cascade | .trip-flow .nx-demo{font-size:11px;color:#a55561;background:var(--nx-red-soft);padding:5px 8px;border-radius:6px} |
| 37 | CSS / visual cascade | .trip-flow .nx-main{padding:20px 18px 21px} |
| 38 | CSS / visual cascade | .trip-flow .nx-trip-meta{font-size:11px;color:var(--nx-muted);letter-spacing:.3px;margin-bottom:5px} |
| 39 | CSS / visual cascade | .trip-flow .nx-route-title{font-size:23px;font-weight:760;letter-spacing:-.7px;line-height:1.3} |
| 40 | CSS / visual cascade | .trip-flow .nx-trip-date{font-size:11px;color:var(--nx-muted);margin-top:7px;display:flex;align-items:center;gap:5px;fle |
| 41 | CSS / visual cascade | .trip-flow .nx-trip-date svg{width:13px;height:13px} |
| 42 | CSS / visual cascade | .trip-flow .nx-progress{padding:0;margin:21px 0;list-style:none;display:flex;gap:7px} |
| 43 | CSS / visual cascade | .trip-flow .nx-progress li{flex:1;border-top:3px solid #e0e5ed;padding-top:8px;font-size:11px;color:var(--nx-muted);min- |
| 44 | CSS / visual cascade | .trip-flow .nx-progress li[data-state="active"]{border-color:var(--nx-red);color:var(--nx-red);font-weight:700} |
| 45 | CSS / visual cascade | .trip-flow .nx-progress li[data-state="done"]{border-color:var(--nx-green);color:var(--nx-green)} |
| 46 | CSS / visual cascade | .trip-flow .nx-panel{padding:19px;background:white;border:1px solid var(--nx-line);border-radius:16px} |
| 47 | CSS / visual cascade | .trip-flow .nx-heading{font-size:18px;font-weight:750;letter-spacing:-.4px;line-height:1.4;margin-bottom:7px} |
| 48 | CSS / visual cascade | .trip-flow .nx-copy{font-size:12px;line-height:1.75;color:var(--nx-muted)} |
| 49 | CSS / visual cascade | .trip-flow .nx-eyebrow{font-size:11px;letter-spacing:.7px;color:var(--nx-muted);font-weight:650;text-transform:uppercase |
| 50 | CSS / visual cascade | .trip-flow .nx-badge{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:6px;background:var(--n |
| 51 | CSS / visual cascade | .trip-flow .nx-badge svg{width:13px;height:13px} |
| 52 | CSS / visual cascade | .trip-flow .nx-places{margin:21px 0 17px} |
| 53 | CSS / visual cascade | .trip-flow .nx-stop{position:relative;display:flex;align-items:flex-start;gap:12px;min-height:61px} |
| 54 | CSS / visual cascade | .trip-flow .nx-stop:last-child{min-height:0} |
| 55 | CSS / visual cascade | .trip-flow .nx-stop:first-child:after{content:"";position:absolute;left:4px;top:15px;bottom:2px;border-left:1px dashed # |
| 56 | CSS / visual cascade | .trip-flow .nx-dot{height:9px;width:9px;border:2px solid var(--nx-red);border-radius:50%;flex-shrink:0;background:white; |
| 57 | CSS / visual cascade | .trip-flow .nx-stop:last-child .nx-dot{border-color:var(--nx-ink);background:var(--nx-ink);border-radius:2px} |
| 58 | CSS / visual cascade | .trip-flow .nx-stop strong{display:block;font-size:15px;font-weight:700;letter-spacing:-.3px} |
| 59 | CSS / visual cascade | .trip-flow .nx-stop small{display:block;font-size:11px;color:var(--nx-muted);margin-top:3px} |
| 60 | CSS / visual cascade | .trip-flow .nx-row{padding:10px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:13px;border-bott |
| 61 | CSS / visual cascade | .trip-flow .nx-row:last-child{border:0} |
| 62 | CSS / visual cascade | .trip-flow .nx-row&gt;span:first-child{color:var(--nx-muted)} |
| 63 | CSS / visual cascade | .trip-flow .nx-row strong{font-weight:650;text-align:right;white-space:nowrap} |
| 64 | CSS / visual cascade | .trip-flow .nx-note{font-size:11px;color:var(--nx-muted);line-height:1.75;margin-top:12px} |
| 65 | CSS / visual cascade | .trip-flow .nx-swipe{position:relative;width:100%;height:58px;background:var(--nx-red-soft);border-radius:14px;margin-to |
| 66 | CSS / visual cascade | .trip-flow .nx-swipe-label{position:absolute;inset:0 15px 0 58px;display:flex;align-items:center;justify-content:center; |
| 67 | CSS / visual cascade | .trip-flow .nx-swipe input{position:absolute;top:0;left:4px;width:calc(100% - 8px);height:58px;appearance:none;-webkit-a |
| 68 | CSS / visual cascade | .trip-flow .nx-swipe input::-webkit-slider-runnable-track{height:58px;background:transparent;border:0} |
| 69 | CSS / visual cascade | .trip-flow .nx-swipe input::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:48px;height:48px;margin-t |
| 70 | CSS / visual cascade | .trip-flow .nx-swipe input::-moz-range-track{height:58px;background:transparent;border:0} |
| 71 | CSS / visual cascade | .trip-flow .nx-swipe input::-moz-range-thumb{width:48px;height:48px;border:0;border-radius:11px;background:transparent} |
| 72 | CSS / visual cascade | .trip-flow .nx-knob{position:absolute;top:5px;left:4px;width:48px;height:48px;display:grid;place-items:center;background |
| 73 | CSS / visual cascade | .trip-flow .nx-knob svg{width:25px;height:25px} |
| 74 | CSS / visual cascade | .trip-flow .nx-swipe.is-disabled{opacity:.45} |
| 75 | CSS / visual cascade | .trip-flow .nx-swipe.is-complete .nx-knob{background:var(--nx-green)} |
| 76 | CSS / visual cascade | .trip-flow .nx-status{display:flex;gap:7px;align-items:flex-start;padding:11px 12px;background:var(--nx-green-soft);colo |
| 77 | CSS / visual cascade | .trip-flow .nx-status svg{width:15px;height:15px;flex-shrink:0;margin-top:2px} |
| 78 | CSS / visual cascade | .trip-flow .nx-status.amber{background:var(--nx-amber-soft);color:var(--nx-amber)} |
| 79 | CSS / visual cascade | .trip-flow .nx-navigation{margin-top:16px} |
| 80 | CSS / visual cascade | .trip-flow .nx-location{display:flex;gap:12px;align-items:flex-start;margin:19px 0 17px} |
| 81 | CSS / visual cascade | .trip-flow .nx-pin-box{width:43px;height:43px;border-radius:13px;display:grid;place-items:center;color:var(--nx-red);bac |
| 82 | CSS / visual cascade | .trip-flow .nx-pin-box svg{width:22px;height:22px} |
| 83 | CSS / visual cascade | .trip-flow .nx-location strong{font-size:16px;font-weight:700;display:block;letter-spacing:-.3px} |
| 84 | CSS / visual cascade | .trip-flow .nx-location small{font-size:11px;color:var(--nx-muted);display:block;margin-top:5px} |
| 85 | CSS / visual cascade | .trip-flow .nx-button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;width:100%;backgrou |
| 86 | CSS / visual cascade | .trip-flow .nx-button.primary{background:var(--nx-red);border-color:var(--nx-red);color:white} |
| 87 | CSS / visual cascade | .trip-flow .nx-button svg{height:17px;width:17px} |
| 88 | CSS / visual cascade | .trip-flow .nx-button:disabled{opacity:.42} |
| 89 | CSS / visual cascade | .trip-flow .nx-actions{display:grid;gap:9px;margin-top:20px} |
| 90 | CSS / visual cascade | .trip-flow .nx-otp-icon{width:49px;height:49px;border-radius:15px;display:grid;place-items:center;background:var(--nx-re |
| 91 | CSS / visual cascade | .trip-flow .nx-otp-icon svg{height:24px;width:24px} |
| 92 | CSS / visual cascade | .trip-flow .nx-otp-label{display:block;font-size:12px;margin-top:22px;color:var(--nx-muted)} |
| 93 | CSS / visual cascade | .trip-flow .nx-otp-input{display:block;width:100%;border:1px solid #d8dfe9;border-radius:12px;padding:14px 10px 14px 20p |
| 94 | CSS / visual cascade | .trip-flow .nx-demo-code{font-size:11px;color:#995762;margin-top:9px} |
| 95 | CSS / visual cascade | .trip-flow .nx-otp-error,.trip-flow .nx-form-error{font-size:11px;color:var(--nx-red);margin-top:10px;line-height:1.7} |
| 96 | CSS / visual cascade | .trip-flow .nx-otp-error:empty,.trip-flow .nx-form-error:empty{display:none} |
| 97 | CSS / visual cascade | .trip-flow .nx-field{display:block;font-size:12px;margin-top:17px;color:var(--nx-ink)} |
| 98 | CSS / visual cascade | .trip-flow .nx-field input,.trip-flow .nx-field select{display:block;width:100%;min-width:0;margin-top:7px;border:1px so |
| 99 | CSS / visual cascade | .trip-flow .nx-field small{font-size:11px;line-height:1.7;color:var(--nx-muted);display:block;margin-top:6px} |
| 100 | CSS / visual cascade | .trip-flow .nx-running input{font-size:28px;font-weight:700;letter-spacing:-.5px;padding:13px 15px} |
| 101 | CSS / visual cascade | .trip-flow .nx-rate{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--nx-muted);margin-t |
| 102 | CSS / visual cascade | .trip-flow .nx-rate span{background:var(--nx-bg);border-radius:6px;padding:6px 8px} |
| 103 | CSS / visual cascade | .trip-flow .nx-bill{padding:15px;background:var(--nx-bg);border-radius:13px;margin-top:18px} |
| 104 | CSS / visual cascade | .trip-flow .nx-bill-title{font-size:12px;font-weight:700;margin-bottom:7px} |
| 105 | CSS / visual cascade | .trip-flow .nx-bill .nx-row{font-size:11px;border-color:#e6eaf0;padding:8px 0} |
| 106 | CSS / visual cascade | .trip-flow .nx-bill .nx-total{border-top:1px solid #dbe1ea;padding-top:13px;margin-top:5px;align-items:center;font-size: |
| 107 | CSS / visual cascade | .trip-flow .nx-total strong{font-size:27px;font-weight:780;letter-spacing:-.8px;color:var(--nx-red)} |
| 108 | CSS / visual cascade | .trip-flow .nx-charges{margin-top:16px;border-top:1px solid var(--nx-line);border-bottom:1px solid var(--nx-line);paddin |
| 109 | CSS / visual cascade | .trip-flow .nx-charges summary{padding:7px 0;min-height:36px;display:list-item;font-size:12px;font-weight:650} |
| 110 | CSS / visual cascade | .trip-flow .nx-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px} |
| 111 | CSS / visual cascade | .trip-flow .nx-field-grid .nx-field{min-width:0} |
| 112 | CSS / visual cascade | .trip-flow .nx-review-fare{padding:19px;border-radius:12px;background:var(--nx-red-soft);margin:18px 0 12px;display:flex |
| 113 | CSS / visual cascade | .trip-flow .nx-review-fare span{font-size:12px;color:#a55561} |
| 114 | CSS / visual cascade | .trip-flow .nx-review-fare strong{font-size:29px;color:var(--nx-red);letter-spacing:-.7px;font-weight:780} |
| 115 | CSS / visual cascade | .trip-flow .nx-success-icon{height:60px;width:60px;border-radius:19px;background:var(--nx-green-soft);color:var(--nx-gre |
| 116 | CSS / visual cascade | .trip-flow .nx-success-icon svg{height:29px;width:29px} |
| 117 | CSS / visual cascade | .trip-flow .nx-live{font-size:11px;color:var(--nx-muted);line-height:1.7;padding:0 18px 17px} |
| 118 | CSS / visual cascade | .trip-flow .nx-live:empty{display:none} |
| 119 | CSS / visual cascade | .trip-flow .nx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap} |
| 120 | CSS / visual cascade | .trip-flow i[data-lucide]{display:inline-block;width:18px;height:18px} |
| 121 | CSS / visual cascade | @media(max-width:360px){.trip-flow{padding:8px 0}.trip-flow .nx-main{padding:17px 13px}.trip-flow .nx-panel{padding:16px |
| 122 | CSS / visual cascade | @media(prefers-reduced-motion:reduce){.trip-flow *{transition:none!important}} |
| 123 | CSS / visual cascade | Blank separator |
| 124 | CSS / visual cascade | Blank separator |
| 125 | CSS / visual cascade | .trip-flow{display:block;padding:0;margin:0 auto;max-width:650px;background:transparent;font-family:inherit}.trip-flow . |
| 126 | CSS / visual cascade | @media(max-width:700px){.mobile-page-heading{display:block;font-size:22px;font-weight:750;letter-spacing:-.6px;margin-bo |
| 127 | CSS / visual cascade | @media(max-width:360px){.trip-flow{padding:0}.trip-flow .nx-panel{padding:15px}.trip-flow .nx-swipe-label{font-size:11px |
| 128 | CSS / visual cascade | @media print{.topbar,.preview-note,.trip-back,.trip-flow .nx-progress,.trip-flow .nx-actions,.mobile-page-heading{displa |
| 129 | CSS / visual cascade | Blank separator |
| 130 | CSS / visual cascade | Blank separator |
| 131 | CSS / visual cascade | @media(max-width:700px){.bottom-nav .nav-button{font-size:11px}.page-subtitle,.section-heading p,.duty-info,.duty-meta,. |
| 132 | CSS / visual cascade | .trip-flow .nx-close-panel{padding:22px} |
| 133 | CSS / visual cascade | .trip-flow .nx-close-heading{display:flex;align-items:center;gap:13px;margin-bottom:13px} |
| 134 | CSS / visual cascade | .trip-flow .nx-close-heading .nx-pin-box{margin:0;width:45px;height:45px;border-radius:14px} |
| 135 | CSS / visual cascade | .trip-flow .nx-close-heading .nx-eyebrow{font-size:10px;letter-spacing:1.2px;margin-bottom:3px} |
| 136 | CSS / visual cascade | .trip-flow .nx-close-heading .nx-heading{margin:0;font-size:19px} |
| 137 | CSS / visual cascade | .trip-flow .nx-close-panel .nx-copy{font-size:12px;line-height:1.8} |
| 138 | CSS / visual cascade | .trip-flow .nx-close-panel .nx-running{margin-top:24px;font-size:12px;font-weight:650} |
| 139 | CSS / visual cascade | .trip-flow .nx-km-control{display:flex;align-items:center;gap:10px;border:1.5px solid #d8dfe9;border-radius:13px;backgro |
| 140 | CSS / visual cascade | .trip-flow .nx-km-control:focus-within{border-color:var(--nx-red)} |
| 141 | CSS / visual cascade | .trip-flow .nx-km-control input{width:100%;min-width:0;padding:12px 0;border:0;background:transparent;font-size:36px;lin |
| 142 | CSS / visual cascade | .trip-flow .nx-km-control input::-webkit-inner-spin-button,.trip-flow .nx-km-control input::-webkit-outer-spin-button{ap |
| 143 | CSS / visual cascade | .trip-flow .nx-km-control&gt;span{font-size:16px;color:var(--nx-muted)} |
| 144 | CSS / visual cascade | .trip-flow .nx-km-control input::placeholder{color:#b8bec9} |
| 145 | CSS / visual cascade | .trip-flow .nx-close-panel #app-km-help{margin-top:8px} |
| 146 | CSS / visual cascade | .trip-flow .nx-separate-note{display:flex;align-items:flex-start;gap:9px;margin-top:22px;padding-top:17px;border-top:1px |
| 147 | CSS / visual cascade | .trip-flow .nx-separate-note&gt;.icon{width:16px;height:16px;flex-shrink:0;margin-top:2px} |
| 148 | CSS / visual cascade | .trip-flow .nx-separate-note p{font-size:11px;line-height:1.8;min-width:0} |
| 149 | CSS / visual cascade | .trip-flow .nx-separate-note strong{display:block;color:var(--nx-ink);font-size:11px;font-weight:600} |
| 150 | CSS / visual cascade | .trip-flow .nx-separate-note span{display:block;margin-top:3px} |
| 151 | CSS / visual cascade | .trip-flow .nx-close-panel .nx-actions{margin-top:23px} |
| 152 | CSS / visual cascade | .trip-flow .nx-close-panel .nx-button{min-height:49px;font-size:13px} |
| 153 | CSS / visual cascade | .trip-flow .nx-collection-card{background:var(--nx-red-soft);border-radius:14px;padding:23px 18px;margin:20px 0 12px;tex |
| 154 | CSS / visual cascade | .trip-flow .nx-collection-label{display:block;font-size:12px;font-weight:500;color:#96414c} |
| 155 | CSS / visual cascade | .trip-flow .nx-collection-card&gt;strong{display:block;color:var(--nx-red);font-size:43px;font-weight:780;letter-spacing:-1 |
| 156 | CSS / visual cascade | .trip-flow .nx-collection-card&gt;small{display:block;color:#96414c;font-size:11px} |
| 157 | CSS / visual cascade | .trip-flow .nx-edit-km{background:transparent;border-color:transparent;color:var(--nx-muted)} |
| 158 | CSS / visual cascade | .trip-flow .nx-settlement-note{display:flex;justify-content:center;gap:6px;margin-top:13px;font-size:10px;line-height:1. |
| 159 | CSS / visual cascade | .trip-flow .nx-settlement-note .icon{width:14px;height:14px;flex-shrink:0;margin-top:2px} |
| 160 | CSS / visual cascade | @media(max-width:360px){.trip-flow .nx-close-panel{padding:17px}.trip-flow .nx-close-heading{gap:10px}.trip-flow .nx-clo |
| 161 | CSS / visual cascade | Blank separator |
| 162 | CSS / visual cascade | .topbar .header-status{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:8px |
| 163 | CSS / visual cascade | .header-status .status-dot{width:6px;height:6px;flex-shrink:0;background:#147648} |
| 164 | CSS / visual cascade | .header-status[aria-checked="false"]{background:#f0f1f3;border-color:#e2e4e8;color:#666d78} |
| 165 | CSS / visual cascade | .header-status[aria-checked="false"] .status-dot{background:#818792} |
| 166 | CSS / visual cascade | .header-toggle{display:block;position:relative;width:26px;height:16px;border-radius:20px;background:#168557;flex-shrink: |
| 167 | CSS / visual cascade | .header-toggle:after{content:"";position:absolute;left:12px;top:3px;width:10px;height:10px;border-radius:50%;background: |
| 168 | CSS / visual cascade | .header-status[aria-checked="false"] .header-toggle{background:#9ba1aa} |
| 169 | CSS / visual cascade | .header-status[aria-checked="false"] .header-toggle:after{left:3px} |
| 170 | CSS / visual cascade | .topbar{gap:10px;margin-bottom:20px;min-width:0} |
| 171 | CSS / visual cascade | .topbar&gt;div:first-child{min-width:0} |
| 172 | CSS / visual cascade | .topbar .mobile-brand{display:flex;gap:7px;align-items:center} |
| 173 | CSS / visual cascade | .topbar .home-title,.topbar .page-subtitle,.topbar .date-tag{display:none} |
| 174 | CSS / visual cascade | .header-actions{gap:7px;flex-shrink:0} |
| 175 | CSS / visual cascade | .header-actions .header-support{display:none} |
| 176 | CSS / visual cascade | .trip-flow .nx-pickup-summary{display:flex;align-items:center;gap:9px;margin:18px 0;padding:12px 0;border-top:1px solid  |
| 177 | CSS / visual cascade | .trip-flow .nx-pickup-summary&gt;.icon{color:var(--nx-red);width:19px;height:19px;flex-shrink:0} |
| 178 | CSS / visual cascade | .trip-flow .nx-pickup-summary small{display:block;font-size:11px;color:var(--nx-muted)} |
| 179 | CSS / visual cascade | .trip-flow .nx-pickup-summary strong{display:block;font-size:12px;margin-top:3px;font-weight:600} |
| 180 | CSS / visual cascade | .trip-flow .nx-photo-checks{display:grid;gap:13px} |
| 181 | CSS / visual cascade | .trip-flow .nx-photo-check{display:flex;gap:10px;align-items:center;padding:14px 0;border-bottom:1px solid var(--nx-line |
| 182 | CSS / visual cascade | .trip-flow .nx-photo-check:last-child{border-bottom:0} |
| 183 | CSS / visual cascade | .trip-flow .nx-photo-thumb{height:49px;width:49px;flex-shrink:0;display:grid;place-items:center;border-radius:12px;backg |
| 184 | CSS / visual cascade | .trip-flow .nx-photo-thumb .icon{width:22px;height:22px} |
| 185 | CSS / visual cascade | .trip-flow .nx-photo-thumb img{width:100%;height:100%;object-fit:cover} |
| 186 | CSS / visual cascade | .trip-flow .nx-photo-copy{flex:1;min-width:0} |
| 187 | CSS / visual cascade | .trip-flow .nx-photo-copy small{display:block;font-size:10px;letter-spacing:.8px;color:var(--nx-muted);margin-bottom:4px |
| 188 | CSS / visual cascade | .trip-flow .nx-photo-copy strong{display:block;font-size:12px;font-weight:650;line-height:1.5} |
| 189 | CSS / visual cascade | .trip-flow .nx-photo-copy p{font-size:11px;color:var(--nx-muted);line-height:1.6;margin-top:3px} |
| 190 | CSS / visual cascade | .trip-flow .nx-photo-action{min-height:44px;border:0;background:transparent;padding:6px 0 6px 5px;font-size:11px;font-we |
| 191 | CSS / visual cascade | .trip-flow .nx-photo-action .icon{width:14px;height:14px} |
| 192 | CSS / visual cascade | .trip-flow .nx-photo-action:disabled{color:#a9aeb7} |
| 193 | CSS / visual cascade | .trip-flow .is-captured .nx-photo-copy p{color:var(--nx-green)} |
| 194 | CSS / visual cascade | .trip-flow .nx-camera-only{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;color:var(--nx- |
| 195 | CSS / visual cascade | .trip-flow .nx-camera-only .icon{width:14px;height:14px;flex-shrink:0} |
| 196 | CSS / visual cascade | .trip-flow .nx-camera-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px} |
| 197 | CSS / visual cascade | .trip-flow .nx-live-badge{display:inline-flex;align-items:center;gap:6px;border-radius:7px;background:var(--nx-red-soft) |
| 198 | CSS / visual cascade | .trip-flow .nx-live-badge&gt;span{width:5px;height:5px;border-radius:50%;background:currentColor} |
| 199 | CSS / visual cascade | .trip-flow .nx-camera-frame{width:100%;aspect-ratio:4/5;background:#192025;border-radius:18px;position:relative;overflow |
| 200 | CSS / visual cascade | .trip-flow .nx-camera-frame.is-car{aspect-ratio:4/3} |
| 201 | CSS / visual cascade | .trip-flow .nx-camera-frame video,.trip-flow .nx-camera-result{display:block;width:100%;height:100%;object-fit:cover} |
| 202 | CSS / visual cascade | .trip-flow .is-selfie video{transform:scaleX(-1)} |
| 203 | CSS / visual cascade | .trip-flow .nx-camera-result{object-fit:contain;background:#192025} |
| 204 | CSS / visual cascade | .trip-flow .nx-camera-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justif |
| 205 | CSS / visual cascade | .trip-flow .nx-camera-placeholder .icon{width:45px;height:45px} |
| 206 | CSS / visual cascade | .trip-flow .nx-camera-guide{position:absolute;inset:12% 18%;border:2px solid #f6f7f9a8;border-radius:48%;pointer-events: |
| 207 | CSS / visual cascade | .trip-flow .is-car .nx-camera-guide{inset:19% 8%;border-radius:12px} |
| 208 | CSS / visual cascade | .trip-flow .nx-camera-message{font-size:11px;line-height:1.8;color:var(--nx-muted);text-align:center;min-height:36px} |
| 209 | CSS / visual cascade | .trip-flow .nx-camera-page .nx-actions{margin-top:17px} |
| 210 | CSS / visual cascade | .trip-flow .nx-collection-card.is-paid{background:var(--nx-green-soft)} |
| 211 | CSS / visual cascade | .trip-flow .nx-collection-card.is-paid&gt;strong{color:var(--nx-green)} |
| 212 | CSS / visual cascade | .trip-flow .nx-collection-card.is-paid .nx-collection-label,.trip-flow .nx-collection-card.is-paid&gt;small{color:#286b4c} |
| 213 | CSS / visual cascade | .trip-flow .nx-payment-hint{font-size:11px;line-height:1.8;color:var(--nx-muted);margin-top:14px} |
| 214 | CSS / visual cascade | @media(max-width:700px){.workspace{padding-top:14px}.topbar{margin-bottom:22px}.topbar .mobile-brand .real-logo{width:38 |
| 215 | CSS / visual cascade | @media(max-width:360px){.trip-flow .nx-photo-check{gap:8px}.trip-flow .nx-photo-thumb{width:41px;height:45px}.trip-flow  |
| 216 | CSS / visual cascade | Blank separator |
| 217 | CSS / visual cascade | .trip-flow .nx-customer{margin-bottom:16px;padding:17px 18px} |
| 218 | CSS / visual cascade | .trip-flow .nx-customer-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px |
| 219 | CSS / visual cascade | .trip-flow .nx-customer-heading h3{font-size:13px;font-weight:650;letter-spacing:-.1px;margin:0} |
| 220 | CSS / visual cascade | .trip-flow .nx-customer-state{display:inline-flex;align-items:center;gap:4px;padding:4px 7px;border-radius:6px;backgroun |
| 221 | CSS / visual cascade | .trip-flow .nx-customer-state .icon{width:12px;height:12px} |
| 222 | CSS / visual cascade | .trip-flow .nx-customer-state.is-open{background:var(--nx-green-soft);color:var(--nx-green)} |
| 223 | CSS / visual cascade | .trip-flow .nx-customer-row{display:flex;align-items:center;gap:10px;min-width:0;padding:11px 0;border-bottom:1px solid  |
| 224 | CSS / visual cascade | .trip-flow .nx-customer-row&gt;div:nth-child(2){flex:1;min-width:0} |
| 225 | CSS / visual cascade | .trip-flow .nx-customer-icon{width:31px;height:34px;display:grid;place-items:center;color:var(--nx-muted);flex-shrink:0} |
| 226 | CSS / visual cascade | .trip-flow .nx-customer-icon .icon{width:18px;height:18px} |
| 227 | CSS / visual cascade | .trip-flow .nx-customer-row span{display:block;font-size:11px;color:var(--nx-muted);margin-bottom:4px} |
| 228 | CSS / visual cascade | .trip-flow .nx-customer-row strong{display:block;font-size:13px;font-weight:650;line-height:1.5;overflow-wrap:anywhere} |
| 229 | CSS / visual cascade | .trip-flow .nx-customer-row .is-masked{letter-spacing:2px;color:#8e959f} |
| 230 | CSS / visual cascade | .trip-flow .nx-call-customer{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:42px;paddi |
| 231 | CSS / visual cascade | .trip-flow .nx-call-customer .icon{width:14px;height:14px} |
| 232 | CSS / visual cascade | .trip-flow .nx-call-customer:disabled{background:var(--nx-bg);color:#9ba2ac} |
| 233 | CSS / visual cascade | .trip-flow .nx-customer-note{font-size:10px;line-height:1.8;color:var(--nx-muted);margin-top:11px} |
| 234 | CSS / visual cascade | .trip-flow .nx-customer-unlock{display:flex;align-items:flex-start;gap:8px;margin-top:12px;padding:10px 11px;border-radi |
| 235 | CSS / visual cascade | .trip-flow .nx-customer-unlock&gt;.icon{width:15px;height:15px;flex-shrink:0;margin-top:2px} |
| 236 | CSS / visual cascade | .trip-flow .nx-customer-unlock p{font-size:11px;line-height:1.7} |
| 237 | CSS / visual cascade | .trip-flow .nx-customer-unlock strong{display:block;font-weight:500;color:var(--nx-ink)} |
| 238 | CSS / visual cascade | .trip-flow .nx-customer-unlock span{display:block;margin-top:2px} |
| 239 | CSS / visual cascade | @media(max-width:360px){.trip-flow .nx-customer{padding:15px}.trip-flow .nx-customer-row{gap:7px}.trip-flow .nx-customer |
| 240 | CSS / visual cascade | Blank separator |
| 241 | CSS / visual cascade | :root{--page:#f6f7f9;--red:#d82035;--red-soft:#fff0f2;--ink:#171b24;--muted:#6f7785;--line:#e7eaf0;--shadow:0 3px 14px # |
| 242 | CSS / visual cascade | body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;letter-spacing:-.08px} |
| 243 | CSS / visual cascade | .panel{border-color:var(--line);box-shadow:var(--shadow);border-radius:16px} |
| 244 | CSS / visual cascade | .topbar{position:relative;background:#fff;padding:16px 20px;margin:-16px -20px 22px;border-bottom:1px solid var(--line); |
| 245 | CSS / visual cascade | .brand-name,.topbar .mobile-brand .brand-name{font-family:Arial,"Helvetica Neue",sans-serif;font-size:19px;font-weight:7 |
| 246 | CSS / visual cascade | .brand-label,.topbar .mobile-brand .brand-label{display:flex;align-items:center;gap:5px;font-size:9px;font-weight:600;le |
| 247 | CSS / visual cascade | .brand-label:before{content:"";display:inline-block;width:10px;height:2px;background:var(--red);border-radius:2px} |
| 248 | CSS / visual cascade | .real-logo{mix-blend-mode:multiply} |
| 249 | CSS / visual cascade | .topbar .mobile-brand{gap:8px} |
| 250 | CSS / visual cascade | .topbar .mobile-brand .real-logo{width:38px;height:40px} |
| 251 | CSS / visual cascade | .topbar .header-status{min-height:40px;font-size:11px;padding:7px 9px} |
| 252 | CSS / visual cascade | .topbar .icon-button{width:38px;min-width:38px;height:40px;border-radius:12px} |
| 253 | CSS / visual cascade | .topbar .header-actions{gap:7px} |
| 254 | CSS / visual cascade | .workspace{padding-top:20px} |
| 255 | CSS / visual cascade | .section-heading h2{font-size:16px;font-weight:700;letter-spacing:-.3px} |
| 256 | CSS / visual cascade | .section-heading .text-button{font-size:11px} |
| 257 | CSS / visual cascade | .dashboard-grid{gap:22px;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)} |
| 258 | CSS / visual cascade | .nx-compact-trip{border-top:2px solid var(--red);overflow:hidden} |
| 259 | CSS / visual cascade | .nx-compact-trip .next-top{padding:17px 18px 0;align-items:flex-start;gap:12px} |
| 260 | CSS / visual cascade | .nx-compact-trip .pickup-date{font-size:11px;font-weight:500;color:var(--muted);margin:0 0 6px;line-height:1.5} |
| 261 | CSS / visual cascade | .nx-compact-trip .pickup-time{font-size:27px;font-weight:750;letter-spacing:-1px;line-height:1.2} |
| 262 | CSS / visual cascade | .nx-compact-trip .badge{font-size:10px;padding:6px 8px;max-width:135px;line-height:1.5;white-space:normal;text-align:lef |
| 263 | CSS / visual cascade | .nx-compact-trip .badge .icon{flex-shrink:0} |
| 264 | CSS / visual cascade | .nx-compact-trip .route-stack{padding:18px 18px 13px} |
| 265 | CSS / visual cascade | .nx-compact-trip .route-stop{min-height:56px;padding-left:0;gap:12px} |
| 266 | CSS / visual cascade | .nx-compact-trip .route-stop:last-child{min-height:0} |
| 267 | CSS / visual cascade | .nx-compact-trip .route-stop strong{font-size:16px;font-weight:700;line-height:1.45} |
| 268 | CSS / visual cascade | .nx-compact-trip .route-stop p{font-size:11px;line-height:1.7;margin-top:2px;color:var(--muted)} |
| 269 | CSS / visual cascade | .nx-compact-trip .route-stop:after{left:4px} |
| 270 | CSS / visual cascade | .nx-compact-trip .trip-facts{margin:0 18px 14px;font-size:11px;gap:14px;flex-wrap:wrap} |
| 271 | CSS / visual cascade | .nx-compact-trip .trip-facts .icon{width:14px;height:14px} |
| 272 | CSS / visual cascade | .nx-compact-trip .next-bottom{padding:13px 18px 17px;background:#fff;border-top:1px solid var(--line)} |
| 273 | CSS / visual cascade | .nx-card-payout{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px} |
| 274 | CSS / visual cascade | .nx-card-payout small{display:block;font-size:11px;font-weight:600;color:#424b5a;line-height:1.5} |
| 275 | CSS / visual cascade | .nx-card-payout span{display:block;font-size:10px;color:var(--muted);line-height:1.6;margin-top:2px} |
| 276 | CSS / visual cascade | .nx-card-payout strong{font-size:24px;font-weight:750;letter-spacing:-.7px;white-space:nowrap} |
| 277 | CSS / visual cascade | .nx-compact-trip .button{min-height:46px;border-radius:11px;font-size:12px;font-weight:650} |
| 278 | CSS / visual cascade | .duties-list{gap:12px} |
| 279 | CSS / visual cascade | .duty-card{padding:17px 18px;border-radius:15px} |
| 280 | CSS / visual cascade | .duty-route{font-weight:700;font-size:15px;line-height:1.6} |
| 281 | CSS / visual cascade | .duty-info{font-size:11px;line-height:1.8} |
| 282 | CSS / visual cascade | .duty-meta{font-size:11px} |
| 283 | CSS / visual cascade | .duty-bottom .button{font-size:11px;min-height:42px} |
| 284 | CSS / visual cascade | .list-note{font-size:11px;line-height:1.8} |
| 285 | CSS / visual cascade | .page-tabs{flex-wrap:wrap;gap:7px} |
| 286 | CSS / visual cascade | .pill-button{font-size:11px;min-height:38px;padding:8px 11px} |
| 287 | CSS / visual cascade | .trip-flow{max-width:540px} |
| 288 | CSS / visual cascade | .trip-flow .nx-route-title{font-size:23px;font-weight:750;letter-spacing:-.65px} |
| 289 | CSS / visual cascade | .trip-flow .nx-panel{box-shadow:var(--shadow)} |
| 290 | CSS / visual cascade | .trip-flow .nx-progress{margin:18px 0} |
| 291 | CSS / visual cascade | .trip-flow .nx-trip-help{display:flex;justify-content:center;align-items:center;gap:6px;background:none;border:0;min-hei |
| 292 | CSS / visual cascade | .trip-flow .nx-trip-help .icon{width:14px;height:14px} |
| 293 | CSS / visual cascade | .nx-policy{background:#f7f8fa;border:1px solid var(--line);border-radius:12px;padding:14px} |
| 294 | CSS / visual cascade | .nx-policy-title{font-size:12px;font-weight:650;margin-bottom:7px;color:var(--ink)} |
| 295 | CSS / visual cascade | .nx-policy&gt;div:not(.nx-policy-title){display:flex;align-items:flex-start;justify-content:space-between;gap:13px;padding: |
| 296 | CSS / visual cascade | .nx-policy&gt;div&gt;span{min-width:0} |
| 297 | CSS / visual cascade | .nx-policy&gt;div&gt;strong{font-weight:700;color:var(--ink);white-space:nowrap} |
| 298 | CSS / visual cascade | .nx-policy p{font-size:11px;line-height:1.8;color:var(--muted);margin:11px 0 0} |
| 299 | CSS / visual cascade | .nx-policy-short{margin-top:17px;font-size:11px;color:var(--muted);line-height:1.8;padding-top:14px;border-top:1px solid |
| 300 | CSS / visual cascade | .nx-policy-short button{display:inline;background:none;border:0;color:var(--red);padding:4px 0;font-size:11px;font-weigh |
| 301 | CSS / visual cascade | .nx-help-choice{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;paddin |
| 302 | CSS / visual cascade | .nx-help-choice&gt;span{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0} |
| 303 | CSS / visual cascade | .nx-help-choice .icon{width:17px;height:17px;color:var(--muted);flex-shrink:0} |
| 304 | CSS / visual cascade | .nx-help-choice small{display:block;width:100%;font-size:11px;color:var(--muted);font-weight:400;margin-left:25px;line-h |
| 305 | CSS / visual cascade | .nx-cancel-fee{padding:15px;background:#fff5e8;border-radius:12px;color:#795115} |
| 306 | CSS / visual cascade | .nx-cancel-fee&gt;div{display:flex;align-items:center;justify-content:space-between;gap:12px} |
| 307 | CSS / visual cascade | .nx-cancel-fee span{font-size:12px;font-weight:500} |
| 308 | CSS / visual cascade | .nx-cancel-fee strong{font-size:25px;letter-spacing:-.7px;font-weight:750;white-space:nowrap} |
| 309 | CSS / visual cascade | .nx-cancel-fee p{font-size:11px;line-height:1.8;margin:7px 0 0} |
| 310 | CSS / visual cascade | .nx-cancel-window{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);margin:11px 0 19px;line-heig |
| 311 | CSS / visual cascade | .nx-cancel-window .icon{width:14px;height:14px;flex-shrink:0} |
| 312 | CSS / visual cascade | .nx-cancel-field{display:block;font-size:12px;font-weight:600;color:var(--ink);margin-top:16px} |
| 313 | CSS / visual cascade | .nx-cancel-field select,.nx-cancel-field textarea{display:block;width:100%;min-width:0;border:1px solid #d8dfe9;backgrou |
| 314 | CSS / visual cascade | .nx-cancel-field textarea{resize:vertical;min-height:100px} |
| 315 | CSS / visual cascade | .nx-cancel-explain{font-size:11px;line-height:1.8;color:var(--muted);margin:13px 0 16px} |
| 316 | CSS / visual cascade | .nx-cancel-error{font-size:11px;color:var(--red);line-height:1.8;margin:9px 0} |
| 317 | CSS / visual cascade | .nx-cancel-error:empty{display:none} |
| 318 | CSS / visual cascade | .nx-cancel-policy{margin-top:18px} |
| 319 | CSS / visual cascade | .nx-cancel-policy summary{font-size:11px;color:var(--muted);padding:8px 0;min-height:36px} |
| 320 | CSS / visual cascade | .trip-flow .nx-request-status{margin-bottom:16px} |
| 321 | CSS / visual cascade | .trip-flow .nx-request-status h3{font-size:16px;margin:16px 0 6px;font-weight:700;line-height:1.5} |
| 322 | CSS / visual cascade | .trip-flow .nx-request-status&gt;p{font-size:11px;line-height:1.8;color:var(--nx-muted)} |
| 323 | CSS / visual cascade | .trip-flow .nx-request-status .nx-row strong{max-width:56%;white-space:normal;overflow-wrap:anywhere} |
| 324 | CSS / visual cascade | .page-card .nx-profile-policy{margin-top:18px} |
| 325 | CSS / visual cascade | @media(min-width:701px){.topbar{margin:0 0 24px;padding:0 0 20px;background:transparent}.topbar .mobile-brand{display:no |
| 326 | CSS / visual cascade | @media(max-width:700px){.workspace{padding:15px 17px 98px}.topbar{margin:-15px -17px 20px;padding:14px 17px}.dashboard-g |
| 327 | CSS / visual cascade | @media(max-width:360px){.workspace{padding-left:13px;padding-right:13px}.topbar{margin-left:-13px;margin-right:-13px;pad |
| 328 | CSS / visual cascade | Blank separator |
| 329 | CSS / visual cascade | .trip-flow .nx-trip-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px} |
| 330 | CSS / visual cascade | .trip-flow .nx-trip-toolbar .trip-back{margin:0;flex-shrink:0;min-height:44px} |
| 331 | CSS / visual cascade | .trip-flow .nx-trip-help.nx-trip-help-top{margin:0;max-width:205px;border:1px solid var(--nx-line);border-radius:9px;pad |
| 332 | CSS / visual cascade | .trip-flow .nx-trip-help-top .icon{flex-shrink:0;color:var(--nx-red);width:16px;height:16px} |
| 333 | CSS / visual cascade | .trip-flow .nx-trip-help-top:focus-visible{outline:2px solid var(--nx-red);outline-offset:3px} |
| 334 | CSS / visual cascade | .nx-help-intro{font-size:13px;line-height:1.7;color:var(--ink);margin:0 0 14px} |
| 335 | CSS / visual cascade | .nx-help-choice.nx-request-choice{border:1px solid var(--line);border-radius:11px;background:var(--page);padding:14px 12 |
| 336 | CSS / visual cascade | .nx-request-choice&gt;span&gt;.icon{color:var(--red)} |
| 337 | CSS / visual cascade | .nx-help-rules{padding-left:18px;margin:15px 0 5px;color:var(--muted);font-size:12px;line-height:1.75} |
| 338 | CSS / visual cascade | .nx-help-rules li{margin:0 0 8px} |
| 339 | CSS / visual cascade | .nx-office-call{min-height:46px} |
| 340 | CSS / visual cascade | .nx-office-number{margin:0;color:var(--ink);font-size:13px;font-weight:600;text-align:center;letter-spacing:.3px} |
| 341 | CSS / visual cascade | .nx-office-note{margin:0;color:var(--muted);font-size:11px;line-height:1.6;text-align:center} |
| 342 | CSS / visual cascade | .nx-cancel-explain strong{display:block;color:var(--ink);font-weight:600;margin-bottom:5px} |
| 343 | CSS / visual cascade | Blank separator |
| 344 | CSS / visual cascade | Embedded WOFF wordmark font; decoded and hashed. |
| 345 | CSS / visual cascade | /* NESAM brand signature: original symbol, consistent wordmark, quiet product label. */ |
| 346 | CSS / visual cascade | .nesam-brand{--nesam-signature-red:#e43d32;display:flex;align-items:center;gap:10px;min-width:0;flex-shrink:0} |
| 347 | CSS / visual cascade | .nesam-brand .nesam-symbol{position:relative;display:block;overflow:hidden;width:44px;height:44px;flex:0 0 44px;backgrou |
| 348 | CSS / visual cascade | .nesam-brand .nesam-symbol .real-logo{position:absolute;display:block;left:-13.57%;top:-11.95%;width:127.45%;height:auto |
| 349 | CSS / visual cascade | .nesam-brand .nesam-brand-text{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-widt |
| 350 | CSS / visual cascade | .nesam-brand .nesam-brand-text .brand-name,.topbar .mobile-brand.nesam-brand .brand-name{font-family:"NESAM Wordmark",Ar |
| 351 | CSS / visual cascade | .nesam-brand .nesam-brand-text .brand-label,.topbar .mobile-brand.nesam-brand .brand-label{display:block;padding:0 0 0 1 |
| 352 | CSS / visual cascade | .nesam-brand .brand-label:before{content:none;display:none} |
| 353 | CSS / visual cascade | .sidebar .nesam-brand{gap:10px;margin:0 5px 40px} |
| 354 | CSS / visual cascade | .topbar .mobile-brand.nesam-brand{gap:10px} |
| 355 | CSS / visual cascade | @media(max-width:700px){.topbar{min-height:74px;padding-top:14px;padding-bottom:14px;gap:12px;background:#fff}.topbar&gt;di |
| 356 | CSS / visual cascade | @media(max-width:360px){.topbar{min-height:69px;padding-top:12px;padding-bottom:12px;gap:8px}.topbar .mobile-brand.nesam |
| 357 | CSS / visual cascade | Blank separator |
| 358 | CSS / visual cascade | &lt;/style&gt; |
| 359 | HTML / SVG definitions | &lt;/head&gt; |
| 360 | HTML / SVG definitions | &lt;body&gt; |
| 361 | HTML / SVG definitions | &lt;a class="skip-link" href="#main"&gt;Skip to dashboard&lt;/a&gt; |
| 362 | HTML / SVG definitions | &lt;svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"&gt;&lt;d |
| 363 | HTML / SVG definitions | &lt;symbol id="i-home" viewBox="0 0 24 24"&gt;&lt;path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/&gt;&lt;/symbol&gt; |
| 364 | HTML / SVG definitions | &lt;symbol id="i-trip" viewBox="0 0 24 24"&gt;&lt;circle cx="6" cy="5" r="2"/&gt;&lt;circle cx="18" cy="19" r="2"/&gt;&lt;path d="M8 5h8a4 4  |
| 365 | HTML / SVG definitions | &lt;symbol id="i-chart" viewBox="0 0 24 24"&gt;&lt;path d="M3 3v18h18M7 16v-4m5 4V7m5 9v-6"/&gt;&lt;/symbol&gt; |
| 366 | HTML / SVG definitions | &lt;symbol id="i-wallet" viewBox="0 0 24 24"&gt;&lt;path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m18 5h-5v5h5"/&gt;&lt;path d |
| 367 | HTML / SVG definitions | &lt;symbol id="i-user" viewBox="0 0 24 24"&gt;&lt;circle cx="12" cy="8" r="4"/&gt;&lt;path d="M4 21v-2a8 8 0 0 1 16 0v2"/&gt;&lt;/symbol&gt; |
| 368 | HTML / SVG definitions | &lt;symbol id="i-bell" viewBox="0 0 24 24"&gt;&lt;path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/&gt;&lt; |
| 369 | HTML / SVG definitions | &lt;symbol id="i-arrow" viewBox="0 0 24 24"&gt;&lt;path d="M4 12h16m-6-6 6 6-6 6"/&gt;&lt;/symbol&gt; |
| 370 | HTML / SVG definitions | &lt;symbol id="i-chevron" viewBox="0 0 24 24"&gt;&lt;path d="m9 5 7 7-7 7"/&gt;&lt;/symbol&gt; |
| 371 | HTML / SVG definitions | &lt;symbol id="i-calendar" viewBox="0 0 24 24"&gt;&lt;rect x="3" y="5" width="18" height="16" rx="2"/&gt;&lt;path d="M16 3v4M8 3v4M3 11 |
| 372 | HTML / SVG definitions | &lt;symbol id="i-clock" viewBox="0 0 24 24"&gt;&lt;circle cx="12" cy="12" r="9"/&gt;&lt;path d="M12 7v5l3 2"/&gt;&lt;/symbol&gt; |
| 373 | HTML / SVG definitions | &lt;symbol id="i-pin" viewBox="0 0 24 24"&gt;&lt;path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/&gt;&lt;circle cx="12" cy="10" |
| 374 | HTML / SVG definitions | &lt;symbol id="i-car" viewBox="0 0 24 24"&gt;&lt;path d="m5 8 2-5h10l2 5m-16 9V9h18v8H3Zm2 0v3m14-3v3M6 13h2m8 0h2"/&gt;&lt;/symbol&gt; |
| 375 | HTML / SVG definitions | &lt;symbol id="i-check" viewBox="0 0 24 24"&gt;&lt;path d="m5 12 4 4L19 6"/&gt;&lt;/symbol&gt; |
| 376 | HTML / SVG definitions | &lt;symbol id="i-shield" viewBox="0 0 24 24"&gt;&lt;path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/&gt;&lt;path d="m8 12 3 3 5-6"/&gt;&lt;/symb |
| 377 | HTML / SVG definitions | &lt;symbol id="i-help" viewBox="0 0 24 24"&gt;&lt;path d="M4 14v-2a8 8 0 0 1 16 0v2m-1 6h-3m4-6v4a2 2 0 0 1-2 2"/&gt;&lt;rect x="2" y=" |
| 378 | HTML / SVG definitions | &lt;symbol id="i-close" viewBox="0 0 24 24"&gt;&lt;path d="m6 6 12 12M6 18 18 6"/&gt;&lt;/symbol&gt; |
| 379 | HTML / SVG definitions | &lt;symbol id="i-refresh" viewBox="0 0 24 24"&gt;&lt;path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5m-4 4a8 8 0 0 0 14 5l3-3m0 5v-5h-5" |
| 380 | HTML / SVG definitions | &lt;symbol id="i-power" viewBox="0 0 24 24"&gt;&lt;path d="M12 3v9m-5-7a9 9 0 1 0 10 0"/&gt;&lt;/symbol&gt; |
| 381 | HTML / SVG definitions | &lt;symbol id="i-info" viewBox="0 0 24 24"&gt;&lt;circle cx="12" cy="12" r="9"/&gt;&lt;path d="M12 11v6m0-10v.1"/&gt;&lt;/symbol&gt; |
| 382 | HTML / SVG definitions | &lt;symbol id="i-copy" viewBox="0 0 24 24"&gt;&lt;rect x="8" y="8" width="12" height="13" rx="2"/&gt;&lt;path d="M16 8V3H3v13h5"/&gt;&lt;/sym |
| 383 | HTML / SVG definitions | &lt;symbol id="i-phone" viewBox="0 0 24 24"&gt;&lt;path d="m7 3 3 5-3 3a15 15 0 0 0 6 6l3-3 5 3-1 4C9 23 1 15 3 4z"/&gt;&lt;/symbol&gt; |
| 384 | HTML / SVG definitions | &lt;symbol id="i-document" viewBox="0 0 24 24"&gt;&lt;path d="M14 3H5v18h14V8l-5-5v5h5M8 12h8m-8 4h6"/&gt;&lt;/symbol&gt; |
| 385 | HTML / SVG definitions | &lt;symbol id="i-distance" viewBox="0 0 24 24"&gt;&lt;path d="M3 5h18M3 19h18M6 5v14m12-14v14M6 9h4m4 6h4"/&gt;&lt;/symbol&gt; |
| 386 | HTML / SVG definitions | &lt;/defs&gt;&lt;/svg&gt; |
| 387 | Application shell | &lt;div class="app"&gt; |
| 388 | Application shell | &lt;aside class="sidebar" aria-label="Main navigation"&gt; |
| 389 | Application shell | Embedded JPEG logo plus branding markup; bytes decoded and hashed. |
| 390 | Application shell | &lt;div class="nav-caption"&gt;YOUR WORKSPACE&lt;/div&gt; |
| 391 | Application shell | &lt;nav class="sidebar-nav" aria-label="Desktop pages"&gt;&lt;/nav&gt; |
| 392 | Application shell | &lt;div class="sidebar-bottom"&gt; |
| 393 | Application shell | &lt;div class="support-box"&gt;&lt;svg class="icon" aria-hidden="true"&gt;&lt;use href="#i-help"/&gt;&lt;/svg&gt;&lt;strong&gt;We’re here for you.&lt;/st |
| 394 | Application shell | &lt;div class="side-profile"&gt;&lt;div class="avatar avatar-small" aria-hidden="true"&gt;SK&lt;/div&gt;&lt;div class="side-copy"&gt;&lt;strong&gt;Sur |
| 395 | Application shell | &lt;/div&gt; |
| 396 | Application shell | &lt;/aside&gt; |
| 397 | Application shell | &lt;div class="workspace"&gt; |
| 398 | Application shell | &lt;header class="topbar"&gt; |
| 399 | Application shell | Embedded JPEG logo plus branding markup; bytes decoded and hashed. |
| 400 | Application shell | &lt;div class="header-actions"&gt;&lt;button class="header-status" id="driver-availability" role="switch" aria-checked="true" ari |
| 401 | Application shell | &lt;/header&gt; |
| 402 | Application shell | &lt;main id="main" tabindex="-1"&gt;&lt;/main&gt; |
| 403 | Application shell | &lt;footer class="page-footer"&gt;&lt;span&gt;&lt;svg class="icon" aria-hidden="true"&gt;&lt;use href="#i-shield"/&gt;&lt;/svg&gt;NESAM TOURS &amp; TR |
| 404 | Application shell | &lt;/div&gt; |
| 405 | Application shell | &lt;/div&gt; |
| 406 | Application shell | &lt;nav class="bottom-nav" aria-label="Mobile pages"&gt;&lt;/nav&gt; |
| 407 | Application shell | &lt;dialog id="detail-dialog" aria-labelledby="dialog-title"&gt;&lt;/dialog&gt; |
| 408 | Application shell | &lt;div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"&gt;&lt;/div&gt; |
| 409 | Application shell | &lt;noscript&gt;&lt;p style="padding:24px"&gt;Enable JavaScript to use this interactive dashboard preview.&lt;/p&gt;&lt;/noscript&gt; |
| 410 | JavaScript behavior | &lt;script&gt; |
| 411 | JavaScript behavior | 'use strict'; |
| 412 | JavaScript behavior | // Standalone UI prototype. All duties, balances and document states below are sample data. |
| 413 | JavaScript behavior | // There are no network requests, real assignments, GPS tracking or financial transfers. |
| 414 | JavaScript behavior | const STORAGE_KEY = 'nesam-driver-complete-ux-v6'; |
| 415 | JavaScript behavior | const money = value =&gt; new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',minimumFractionDigits:0,maximumFr |
| 416 | JavaScript behavior | const icon = (name, extra='') =&gt; `&lt;svg class="icon ${extra}" aria-hidden="true"&gt;&lt;use href="#i-${name}"/&gt;&lt;/svg&gt;`; |
| 417 | JavaScript behavior | const NAV = [{id:'home',label:'Home',icon:'home'},{id:'trips',label:'My Trips',icon:'trip'},{id:'earnings',label:'Earnin |
| 418 | JavaScript behavior | const DUTIES = [ |
| 419 | JavaScript behavior | {id:'NSM-261019-014',from:'Chennai',to:'Trichy',pickup:'Koyambedu, Chennai',drop:'Central Bus Stand, Trichy',date:'19 Oc |
| 420 | JavaScript behavior | {id:'NSM-261020-027',from:'Theni',to:'Kochi Airport',pickup:'Theni bus stand, Theni',drop:'Cochin International Airport' |
| 421 | JavaScript behavior | {id:'NSM-261021-009',from:'Theni',to:'Trichy Airport',pickup:'NRT Nagar, Theni',drop:'Tiruchirappalli Airport · departur |
| 422 | JavaScript behavior | {id:'NSM-261019-021',from:'Theni',to:'Dindigul',pickup:'Old bus stand, Theni',drop:'Dindigul town',date:'19 Oct 2026',sh |
| 423 | JavaScript behavior | ]; |
| 424 | JavaScript behavior | const COMPLETED = [{id:'NSM-261018-003',route:'Theni → Dindigul',time:'18 Oct · 07:00 AM',amount:1550},{id:'NSM-261018-0 |
| 425 | JavaScript behavior | const WEEK = [0,1200,0,1800,2100,2500,3250]; |
| 426 | JavaScript behavior | const DEFAULT_STATE = {online:true,assigned:[DUTIES[0].id],notificationsRead:false,notificationsEnabled:true}; |
| 427 | JavaScript behavior | let state=restoreState(), page='home', tripTab='upcoming', dutyFilter='all', earningsPeriod='week', toastTimer, lastTrig |
| 428 | JavaScript behavior | const main=document.getElementById('main'), dialog=document.getElementById('detail-dialog'); |
| 429 | JavaScript behavior | const assignedDuties=()=&gt;DUTIES.filter(d=&gt;state.assigned.includes(d.id)&&getFlow(d.id).stage&lt;6&&!isCancelled(getFlow(d.i |
| 430 | JavaScript behavior | const availableDuties=()=&gt;DUTIES.filter(d=&gt;!state.assigned.includes(d.id)&&Date.parse(d.end)&gt;state.clock); |
| 431 | JavaScript behavior | const conflicts=(candidate,assigned=assignedDuties())=&gt;assigned.find(d=&gt;d.id!==candidate.id && Date.parse(candidate.star |
| 432 | JavaScript behavior | Function persist |
| 433 | JavaScript behavior | Function toast |
| 434 | JavaScript behavior | Function availability |
| 435 | JavaScript behavior | Function metrics |
| 436 | JavaScript behavior | Function routeStack |
| 437 | JavaScript behavior | Function dutyCard |
| 438 | JavaScript behavior | Function availableSection |
| 439 | JavaScript behavior | Function availableSection |
| 440 | JavaScript behavior | Function availableSection |
| 441 | JavaScript behavior | Function availableSection |
| 442 | JavaScript behavior | Function availableSection |
| 443 | JavaScript behavior | Function availableSection |
| 444 | JavaScript behavior | Function availableSection |
| 445 | JavaScript behavior | Function availableSection |
| 446 | JavaScript behavior | Function ledger |
| 447 | JavaScript behavior | Function profilePage |
| 448 | JavaScript behavior | Function openDialog |
| 449 | JavaScript behavior | Function openSupport |
| 450 | JavaScript behavior | Function openPickup |
| 451 | JavaScript behavior | Function copyAddress |
| 452 | JavaScript behavior | Function resetPreview |
| 453 | JavaScript behavior | // Shared trip state for Home, My Trips, trip actions, receipts and pending settlement. |
| 454 | JavaScript behavior | let activeTripId=null; |
| 455 | JavaScript behavior | const FLOW_LABELS=['Confirmed','Heading to pickup','Boarding OTP','On trip','Closing trip','Review closing','Completed'] |
| 456 | JavaScript behavior | const esc=value=&gt;String(value??'').replace(/[&&lt;&gt;"']/g,c=&gt;({'&':'&amp;','&lt;':'&lt;','&gt;':'&gt;','"':'&quot;',"'":'&#39;'}[c |
| 457 | JavaScript behavior | Function freshState |
| 458 | JavaScript behavior | Function blankFlow |
| 459 | JavaScript behavior | Function getFlow |
| 460 | JavaScript behavior | Function calculateTrip |
| 461 | JavaScript behavior | Function calculateTrip |
| 462 | JavaScript behavior | Function calculateTrip |
| 463 | JavaScript behavior | Function calculateTrip |
| 464 | JavaScript behavior | Function calculateTrip |
| 465 | JavaScript behavior | Function calculateTrip |
| 466 | JavaScript behavior | Function calculateTrip |
| 467 | JavaScript behavior | Function calculateTrip |
| 468 | JavaScript behavior | Function calculateTrip |
| 469 | JavaScript behavior | Function calculateTrip |
| 470 | JavaScript behavior | Function sanitizeFlow |
| 471 | JavaScript behavior | Function sanitizeFlow |
| 472 | JavaScript behavior | Function sanitizeFlow |
| 473 | JavaScript behavior | Function sanitizeFlow |
| 474 | JavaScript behavior | Function sanitizeFlow |
| 475 | JavaScript behavior | Function sanitizeFlow |
| 476 | JavaScript behavior | Function sanitizeFlow |
| 477 | JavaScript behavior | Function sanitizeFlow |
| 478 | JavaScript behavior | Function sanitizeFlow |
| 479 | JavaScript behavior | Function sanitizeFlow |
| 480 | JavaScript behavior | Function sanitizeFlow |
| 481 | JavaScript behavior | Function sanitizeFlow |
| 482 | JavaScript behavior | Function sanitizeFlow |
| 483 | JavaScript behavior | Function sanitizeFlow |
| 484 | JavaScript behavior | Function sanitizeFlow |
| 485 | JavaScript behavior | Function sanitizeFlow |
| 486 | JavaScript behavior | Function sanitizeFlow |
| 487 | JavaScript behavior | Function sanitizeFlow |
| 488 | JavaScript behavior | Function restoreState |
| 489 | JavaScript behavior | Function restoreState |
| 490 | JavaScript behavior | Function restoreState |
| 491 | JavaScript behavior | Function restoreState |
| 492 | JavaScript behavior | Function restoreState |
| 493 | JavaScript behavior | Function restoreState |
| 494 | JavaScript behavior | Function restoreState |
| 495 | JavaScript behavior | Function restoreState |
| 496 | JavaScript behavior | Function restoreState |
| 497 | JavaScript behavior | Function restoreState |
| 498 | JavaScript behavior | Function dateText |
| 499 | JavaScript behavior | Function closedRecords |
| 500 | JavaScript behavior | Function allCompleted |
| 501 | JavaScript behavior | Function pendingBase |
| 502 | JavaScript behavior | Function pendingCollections |
| 503 | JavaScript behavior | Function currentDuty |
| 504 | JavaScript behavior | Function refreshIcons |
| 505 | JavaScript behavior | Function updateNav |
| 506 | JavaScript behavior | Function updateNav |
| 507 | JavaScript behavior | Function updateNav |
| 508 | JavaScript behavior | Function updateNav |
| 509 | JavaScript behavior | Function updateNav |
| 510 | JavaScript behavior | Function updateNav |
| 511 | JavaScript behavior | Function updateNav |
| 512 | JavaScript behavior | Function updateNav |
| 513 | JavaScript behavior | Function updateNav |
| 514 | JavaScript behavior | Function updateNav |
| 515 | JavaScript behavior | Function dutyDay |
| 516 | JavaScript behavior | Function nextTrip |
| 517 | JavaScript behavior | Function homePage |
| 518 | JavaScript behavior | Function completedCard |
| 519 | JavaScript behavior | Function cancelledCard |
| 520 | JavaScript behavior | Function tripsPage |
| 521 | JavaScript behavior | Function earningsPage |
| 522 | JavaScript behavior | Function walletPage |
| 523 | JavaScript behavior | Function openDuty |
| 524 | JavaScript behavior | Function acceptDuty |
| 525 | JavaScript behavior | Function openNotifications |
| 526 | JavaScript behavior | Function render |
| 527 | JavaScript behavior | Function goPage |
| 528 | JavaScript behavior | Function openTrip |
| 529 | JavaScript behavior | Function stepTo |
| 530 | JavaScript behavior | Function swipeMarkup |
| 531 | JavaScript behavior | Function navigateButton |
| 532 | JavaScript behavior | // Fictional customer fixtures only. Production must withhold contact data on the server |
| 533 | JavaScript behavior | // until an assigned driver reaches the pickup-minus-eight-hours boundary. |
| 534 | JavaScript behavior | Function customerAccess |
| 535 | JavaScript behavior | Function customerDetails |
| 536 | JavaScript behavior | Function customerDetails |
| 537 | JavaScript behavior | Function customerDetails |
| 538 | JavaScript behavior | Function customerDetails |
| 539 | JavaScript behavior | Function customerDetails |
| 540 | JavaScript behavior | Function customerDetails |
| 541 | JavaScript behavior | Function customerDetails |
| 542 | JavaScript behavior | Function customerDetails |
| 543 | JavaScript behavior | Function tripPage |
| 544 | JavaScript behavior | Function tripPage |
| 545 | JavaScript behavior | Function tripPage |
| 546 | JavaScript behavior | Function tripPage |
| 547 | JavaScript behavior | Function tripPage |
| 548 | JavaScript behavior | Function tripPage |
| 549 | JavaScript behavior | Function tripPage |
| 550 | JavaScript behavior | Function tripPage |
| 551 | JavaScript behavior | Function tripPage |
| 552 | JavaScript behavior | Function tripPage |
| 553 | JavaScript behavior | Function tripPage |
| 554 | JavaScript behavior | Function tripPage |
| 555 | JavaScript behavior | Function tripPage |
| 556 | JavaScript behavior | Function separateChargesNote |
| 557 | JavaScript behavior | Function closingForm |
| 558 | JavaScript behavior | Function cashMoney |
| 559 | JavaScript behavior | Function collectionCard |
| 560 | JavaScript behavior | Function onlinePaymentBadge |
| 561 | JavaScript behavior | Function reviewTrip |
| 562 | JavaScript behavior | Function tripReceipt |
| 563 | JavaScript behavior | Function commitTripSwipe |
| 564 | JavaScript behavior | Function bindTripSliders |
| 565 | JavaScript behavior | Function bindTripSliders |
| 566 | JavaScript behavior | Function bindTripSliders |
| 567 | JavaScript behavior | document.addEventListener('input',event=&gt;{ |
| 568 | JavaScript behavior | const el=event.target; |
| 569 | JavaScript behavior | if(el.id==='app-otp'){el.value=el.value.replace(/\D/g,'').slice(0,4);document.getElementById('app-verify').disabled=el.v |
| 570 | JavaScript behavior | if(el.dataset.flowField==='km'&&page==='trip'&&activeTripId){const f=getFlow(activeTripId);if(f.stage!==4)return;f.km=el |
| 571 | JavaScript behavior | }); |
| 572 | JavaScript behavior | document.addEventListener('submit',event=&gt;{ |
| 573 | JavaScript behavior | if(event.target.id==='app-otp-form'){event.preventDefault();if(page!=='trip'\|\|!activeTripId\|\|getFlow(activeTripId).stage |
| 574 | JavaScript behavior | if(event.target.id==='app-close-form'){event.preventDefault();if(page!=='trip'\|\|!activeTripId)return;const f=getFlow(act |
| 575 | JavaScript behavior | }); |
| 576 | JavaScript behavior | document.addEventListener('click',event=&gt;{ |
| 577 | JavaScript behavior | const button=event.target.closest('button[data-action]');if(!button\|\|button.disabled)return;const{action,id}=button.data |
| 578 | JavaScript behavior | if(action==='flow-open'\|\|action==='flow-receipt')openTrip(id); |
| 579 | JavaScript behavior | if(action==='flow-edit'&&page==='trip'&&getFlow(activeTripId).stage===5)stepTo(4); |
| 580 | JavaScript behavior | if(action==='flow-close'&&page==='trip'&&activeTripId){const f=getFlow(activeTripId);if(f.stage!==5)return;const d=DUTIE |
| 581 | JavaScript behavior | }); |
| 582 | JavaScript behavior | // Camera photographs stay in this tab's memory. This UX demo does not upload images. |
| 583 | JavaScript behavior | const livePhotos=new Map(); |
| 584 | JavaScript behavior | let cameraStream=null,cameraGeneration=0,cameraKind='selfie',cameraImage=null,cameraError='',cameraOpening=false,cameraR |
| 585 | JavaScript behavior | Function photoRecord |
| 586 | JavaScript behavior | Function hasStartPhotos |
| 587 | JavaScript behavior | Function startReady |
| 588 | JavaScript behavior | Function stopCamera |
| 589 | JavaScript behavior | Function startTripChecks |
| 590 | JavaScript behavior | Function cameraPage |
| 591 | JavaScript behavior | Function setCameraError |
| 592 | JavaScript behavior | Function openLiveCamera |
| 593 | JavaScript behavior | Function openLiveCamera |
| 594 | JavaScript behavior | Function openLiveCamera |
| 595 | JavaScript behavior | Function openLiveCamera |
| 596 | JavaScript behavior | Function openLiveCamera |
| 597 | JavaScript behavior | Function openLiveCamera |
| 598 | JavaScript behavior | Function openLiveCamera |
| 599 | JavaScript behavior | Function openLiveCamera |
| 600 | JavaScript behavior | Function openLiveCamera |
| 601 | JavaScript behavior | Function openLiveCamera |
| 602 | JavaScript behavior | Function openLiveCamera |
| 603 | JavaScript behavior | Function openLiveCamera |
| 604 | JavaScript behavior | Function openLiveCamera |
| 605 | JavaScript behavior | Function openLiveCamera |
| 606 | JavaScript behavior | Function openLiveCamera |
| 607 | JavaScript behavior | Function openLiveCamera |
| 608 | JavaScript behavior | Function openLiveCamera |
| 609 | JavaScript behavior | Function openLiveCamera |
| 610 | JavaScript behavior | Function openLiveCamera |
| 611 | JavaScript behavior | Function captureLivePhoto |
| 612 | JavaScript behavior | Embedded JPEG logo plus branding markup; bytes decoded and hashed. |
| 613 | JavaScript behavior | Function useLivePhoto |
| 614 | JavaScript behavior | document.addEventListener('click',event=&gt;{const button=event.target.closest('button[data-action]');if(!button\|\|button.di |
| 615 | JavaScript behavior | document.addEventListener('visibilitychange',()=&gt;{if(document.hidden&&(cameraStream\|\|cameraOpening)){stopCamera();if(pag |
| 616 | JavaScript behavior | window.addEventListener('pagehide',()=&gt;{stopCamera();livePhotos.clear();}); |
| 617 | JavaScript behavior | // This prototype records requests locally. Production decisions must come from NESAM admin. |
| 618 | JavaScript behavior | Function isCancelled |
| 619 | JavaScript behavior | Function cancellationPending |
| 620 | JavaScript behavior | Function cancellationQuote |
| 621 | JavaScript behavior | Function cancellationQuote |
| 622 | JavaScript behavior | Function cancellationQuote |
| 623 | JavaScript behavior | Function cancellationQuote |
| 624 | JavaScript behavior | Function cancellationQuote |
| 625 | JavaScript behavior | Function cancellationQuote |
| 626 | JavaScript behavior | Function cancellationQuote |
| 627 | JavaScript behavior | Function cancellationReason |
| 628 | JavaScript behavior | Function cancellationPolicy |
| 629 | JavaScript behavior | Function openCancellationPolicy |
| 630 | JavaScript behavior | Function tripHelpEntry |
| 631 | JavaScript behavior | Function tripHelpEntry |
| 632 | JavaScript behavior | Function tripHelpEntry |
| 633 | JavaScript behavior | Function tripHelpEntry |
| 634 | JavaScript behavior | Function tripHelpEntry |
| 635 | JavaScript behavior | Function openTripHelp |
| 636 | JavaScript behavior | Function openTripHelp |
| 637 | JavaScript behavior | Function openTripHelp |
| 638 | JavaScript behavior | Function openTripHelp |
| 639 | JavaScript behavior | Function openTripHelp |
| 640 | JavaScript behavior | Function openTripHelp |
| 641 | JavaScript behavior | Function openCancellationRequest |
| 642 | JavaScript behavior | Function openCancellationRequest |
| 643 | JavaScript behavior | Function openCancellationRequest |
| 644 | JavaScript behavior | Function submitCancellation |
| 645 | JavaScript behavior | Function submitCancellation |
| 646 | JavaScript behavior | Function submitCancellation |
| 647 | JavaScript behavior | Function submitCancellation |
| 648 | JavaScript behavior | Function cancellationStatus |
| 649 | JavaScript behavior | Function cancelledRecords |
| 650 | JavaScript behavior | Function cancellationSummary |
| 651 | JavaScript behavior | Function penaltyTotal |
| 652 | JavaScript behavior | Function approvedBalance |
| 653 | JavaScript behavior | Function cancellationLedger |
| 654 | JavaScript behavior | // Simulates a trusted admin response for integration tests; there is no driver control for this. |
| 655 | JavaScript behavior | Function applyAdminCancellationUpdate |
| 656 | JavaScript behavior | document.addEventListener('click',event=&gt;{const button=event.target.closest('button[data-action]');if(!button\|\|button.di |
| 657 | JavaScript behavior | document.addEventListener('submit',event=&gt;{if(event.target.id==='cancel-request-form'){event.preventDefault();submitCanc |
| 658 | JavaScript behavior | Blank separator |
| 659 | JavaScript behavior | document.addEventListener('click',event=&gt;{ |
| 660 | JavaScript behavior | const button=event.target.closest('button[data-action],button[data-page]');if(!button\|\|button.disabled)return; |
| 661 | JavaScript behavior | if(button.dataset.page){goPage(button.dataset.page,button.dataset.tab);return;} |
| 662 | JavaScript behavior | const {action,id,value}=button.dataset; |
| 663 | JavaScript behavior | if(action==='toggle-online'){state.online=!state.online;persist();if(page==='camera')updateNav();else render();const tog |
| 664 | JavaScript behavior | else if(action==='view-duty')openDuty(id); |
| 665 | JavaScript behavior | else if(action==='accept-duty')acceptDuty(id); |
| 666 | JavaScript behavior | else if(action==='close-dialog')dialog.close(); |
| 667 | JavaScript behavior | else if(action==='notifications')openNotifications(); |
| 668 | JavaScript behavior | else if(action==='support')openSupport(); |
| 669 | JavaScript behavior | else if(action==='trip-tab'){tripTab=value;render();main.querySelector(`[data-value="${value}"]`).focus({preventScroll:t |
| 670 | JavaScript behavior | else if(action==='earnings-period'){earningsPeriod=value;render();main.querySelector(`[data-value="${value}"]`).focus({p |
| 671 | JavaScript behavior | else if(action==='today-earnings'){earningsPeriod='today';goPage('earnings');} |
| 672 | JavaScript behavior | else if(action==='wallet-breakdown')openDialog('Sample ledger','Wallet balance breakdown',`&lt;div class="detail-line"&gt;&lt;spa |
| 673 | JavaScript behavior | else if(action==='settlement'){const t=COMPLETED.find(x=&gt;x.id===id);if(t)openDialog(t.id,'Trip settlement receipt',`&lt;div |
| 674 | JavaScript behavior | else if(action==='pickup-address')openPickup(id); |
| 675 | JavaScript behavior | else if(action==='copy-address')copyAddress(id); |
| 676 | JavaScript behavior | else if(action==='refresh'){dutyFilter='all';render();toast('Sample duties refreshed. No live bookings are connected.'); |
| 677 | JavaScript behavior | else if(action==='toggle-notifications'){state.notificationsEnabled=!state.notificationsEnabled;persist();render();main. |
| 678 | JavaScript behavior | else if(action==='reset')resetPreview(); |
| 679 | JavaScript behavior | else if(action==='confirm-reset'){stopCamera();livePhotos.clear();cameraImage=null;state=freshState();activeTripId=null; |
| 680 | JavaScript behavior | }); |
| 681 | JavaScript behavior | document.addEventListener('change',event=&gt;{if(event.target.id==='duty-filter'){dutyFilter=event.target.value;render();do |
| 682 | JavaScript behavior | dialog.addEventListener('click',event=&gt;{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.client |
| 683 | JavaScript behavior | dialog.addEventListener('close',()=&gt;{if(lastTrigger&&lastTrigger.isConnected)lastTrigger.focus({preventScroll:true});els |
| 684 | JavaScript behavior | render(); |
| 685 | JavaScript behavior | Blank separator |
| 686 | JavaScript behavior | &lt;/script&gt; |
| 687 | Document closing | &lt;/body&gt; |
| 688 | Document closing | &lt;/html&gt; |