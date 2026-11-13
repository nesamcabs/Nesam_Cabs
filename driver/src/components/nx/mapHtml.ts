// The live map page shared by LiveMap (Android: inside a WebView) and LiveMap.web (browser: inside an iframe). It is a
// small Leaflet page: map tiles, the duty area, the driver's position and the order pins. The app sends it the data to draw
// (`window.__update(data)`); the page sends back taps on a pin and its own state ({ type: 'ready' | 'select' | 'error' }).
// Leaflet 1.9.4 is loaded from unpkg; the tile server is configurable (EXPO_PUBLIC_MAP_TILE_URL / _ATTRIBUTION) and
// defaults to OpenStreetMap — for production volumes point it at a tile provider you have an agreement with.

export interface LatLng {
  lat: number;
  lng: number;
}

export type MapMarkerKind = 'pickup' | 'drop' | 'order' | 'next';

export interface MapMarker extends LatLng {
  id: string;
  kind: MapMarkerKind;
  /** Short text inside the pin (an order number, P, D). */
  label?: string;
  /** Shown in a tooltip when the pin is tapped. */
  title?: string;
  selected?: boolean;
  /** Approximate position (a published duty shows its area only until it is taken). */
  approx?: boolean;
}

export interface MapLine {
  from: LatLng;
  to: LatLng;
  tone: 'ink' | 'red';
}

export interface MapData {
  me: LatLng | null;
  markers: MapMarker[];
  lines: MapLine[];
  area: { centre: LatLng; radiusKm: number } | null;
  /** The map re-frames itself only when this changes (so a driver's own pan / zoom is kept between refreshes). */
  fitKey: string;
}

export const MAP_TILE_URL = (process.env.EXPO_PUBLIC_MAP_TILE_URL ?? '').trim() || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAP_TILE_ATTRIBUTION = (process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION ?? '').trim() || '&copy; OpenStreetMap contributors';

/** Default view (Erode) before any position is known. */
const DEFAULT_VIEW = { lat: 11.341, lng: 77.7172 };

export function buildMapHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<style>
html,body,#m{height:100%;width:100%;margin:0;padding:0;background:#EEF0F3;font-family:-apple-system,Roboto,'Segoe UI',Arial,sans-serif;-webkit-tap-highlight-color:transparent}
.leaflet-container{background:#EEF0F3}
.pin{box-sizing:border-box;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:700;font-size:11px;line-height:1;box-shadow:0 2px 6px rgba(22,32,51,.28);border:2px solid #fff}
.pin.order{width:28px;height:28px;background:#fff;color:#D82035;border:2px solid #D82035}
.pin.order.sel{width:34px;height:34px;background:#D82035;color:#fff;border-color:#fff;font-size:12px;z-index:1000}
.pin.pickup{width:30px;height:30px;background:#167A50;color:#fff}
.pin.drop{width:30px;height:30px;background:#171B24;color:#fff}
.pin.next{width:28px;height:28px;background:#946000;color:#fff}
.pin.approx{border-style:dashed}
.me{width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 7px rgba(37,99,235,.18),0 1px 4px rgba(0,0,0,.3)}
#fit{position:absolute;z-index:500;left:10px;bottom:10px;height:36px;padding:0 12px;border-radius:9px;border:1px solid #E7EAF0;background:#fff;color:#171B24;font:600 12px -apple-system,Roboto,'Segoe UI',Arial,sans-serif;box-shadow:0 2px 8px rgba(22,32,51,.12)}
#off{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;padding:20px;color:#6F7785;font-size:13px}
.leaflet-tooltip{font-size:11.5px;font-weight:600;color:#171B24;border-radius:7px;border:1px solid #E7EAF0;box-shadow:0 2px 8px rgba(22,32,51,.12)}
</style></head>
<body><div id="m"></div><button id="fit" type="button">Recentre</button><div id="off">The map could not load. Check the internet connection.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
(function(){
  function send(o){var s=JSON.stringify(o);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s);}else if(window.parent&&window.parent!==window){window.parent.postMessage({__nesamMap:true,payload:s},'*');}}
  if(!window.L){document.getElementById('off').style.display='flex';document.getElementById('fit').style.display='none';send({type:'error'});return;}
  var map=L.map('m',{zoomControl:false,attributionControl:true}).setView([${DEFAULT_VIEW.lat},${DEFAULT_VIEW.lng}],12);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.tileLayer(${JSON.stringify(MAP_TILE_URL)},{maxZoom:19,attribution:${JSON.stringify(MAP_TILE_ATTRIBUTION)}}).addTo(map);
  var pins=L.layerGroup().addTo(map),data=null,lastFit=null;
  function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function size(m){return m.kind==='order'?(m.selected?34:28):(m.kind==='next'?28:30);}
  function points(){var p=[];if(!data)return p;if(data.me)p.push([data.me.lat,data.me.lng]);data.markers.forEach(function(m){p.push([m.lat,m.lng]);});return p;}
  function fit(){var p=points();if(!p.length){if(data&&data.area){map.setView([data.area.centre.lat,data.area.centre.lng],12);}return;}
    if(p.length===1){map.setView(p[0],15);return;}map.fitBounds(L.latLngBounds(p),{padding:[46,46],maxZoom:15});}
  window.__update=function(d){
    data=d;pins.clearLayers();
    if(d.area){L.circle([d.area.centre.lat,d.area.centre.lng],{radius:d.area.radiusKm*1000,color:'#D82035',weight:1.2,opacity:.45,dashArray:'6 6',fillColor:'#D82035',fillOpacity:.035,interactive:false}).addTo(pins);}
    (d.lines||[]).forEach(function(l){L.polyline([[l.from.lat,l.from.lng],[l.to.lat,l.to.lng]],{color:l.tone==='red'?'#D82035':'#171B24',weight:3,opacity:.7,dashArray:'7 7',interactive:false}).addTo(pins);});
    d.markers.forEach(function(m){
      var s=size(m);
      var ic=L.divIcon({className:'',html:'<div class="pin '+m.kind+(m.selected?' sel':'')+(m.approx?' approx':'')+'">'+esc(m.label||'')+'</div>',iconSize:[s,s],iconAnchor:[s/2,s/2]});
      var mk=L.marker([m.lat,m.lng],{icon:ic,zIndexOffset:m.selected?1000:(m.kind==='order'?0:500),keyboard:false}).addTo(pins);
      if(m.title){mk.bindTooltip(esc(m.title),{direction:'top',offset:[0,-s/2]});}
      mk.on('click',function(){send({type:'select',id:m.id});});
    });
    if(d.me){L.marker([d.me.lat,d.me.lng],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[16,16],iconAnchor:[8,8]}),interactive:false,zIndexOffset:2000}).addTo(pins);}
    if(d.fitKey!==lastFit){lastFit=d.fitKey;fit();}
  };
  document.getElementById('fit').onclick=function(){fit();};
  window.addEventListener('message',function(e){var x=e.data;if(x&&x.__nesamMapData){window.__update(x.data);}});
  send({type:'ready'});
})();
</script></body></html>`;
}
