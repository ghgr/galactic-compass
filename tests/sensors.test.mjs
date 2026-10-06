import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Run the actual inline application, with controllable browser sensors and
// time. No test hooks or fake sensor controls are shipped in the page.
const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
const catalogue = readFileSync(new URL('../assets/sky-catalog.js',import.meta.url),'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(
  /\}\)\(\);\s*$/,
  'globalThis.app = {camera,deviceMatrix,magneticField,vectorAltAz,dot,state,observerState,sensors,draw,stars,deepSky,formatRA,formatDec,equatorial,galToEq,enuToEq,eqToENU,project,view,panoramaUV,reserveLabel,resetLabelBoxes};})();'
);

function browser(options={}) {
  let now = Date.UTC(2026,9,6,12);
  class Clock extends Date {
    constructor(...args) {super(...(args.length ? args : [now]));}
    static now() {return now;}
  }
  const eventTarget = object => {
    const listeners = new Map();
    return Object.assign(object,{
      addEventListener(type,fn) {
        if (!listeners.has(type)) listeners.set(type,new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type,fn) {listeners.get(type)?.delete(fn);},
      emit(type,event={}) {for (const fn of listeners.get(type) ?? []) fn(event);},
      count(type) {return listeners.get(type)?.size ?? 0;}
    });
  };
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id]) => [id,eventTarget({
    textContent:'',checked:true,hidden:false,disabled:false,dataset:{},width:900,height:900,
    setAttribute(key,value) {this[key]=value;},focus() {}
  })]));
  const context2d = new Proxy({createRadialGradient:() => ({addColorStop(){}}),measureText:text => ({width:text.length*7})}, {
    get:(target,key) => key in target ? target[key] : () => {},
    set:(target,key,value) => {target[key]=value;return true;}
  });
  elements.get('canvas').getContext = () => context2d;
  const document = eventTarget({hidden:false,getElementById:id => elements.get(id) ?? null});
  const watches = new Map(), cleared = [], permissions = [], frames = new Map();
  let nextWatch = 0, nextFrame = 0;
  const geolocation = {
    watchPosition(success,error,settings) {
      const id = nextWatch++;
      watches.set(id,{success,error,settings});
      return id;
    },
    clearWatch(id) {cleared.push(id);}
  };
  const Orientation = function() {};
  if (options.permission) Orientation.requestPermission = absolute => {
    permissions.push(absolute);
    return options.permission(absolute);
  };
  const context = eventTarget({
    Date:Clock,document,navigator:{geolocation:options.noLocation ? undefined : geolocation},
    isSecureContext:options.secure ?? true,
    DeviceOrientationEvent:options.noOrientation ? undefined : Orientation,
    screen:{orientation:eventTarget({angle:0})},
    requestAnimationFrame(fn) {const id=nextFrame++;frames.set(id,fn);return id;},
    cancelAnimationFrame(id) {frames.delete(id);},
    setInterval(fn) {context.tick=fn;},Promise,console
  });
  context.window = context;
  if (options.absoluteEvents) context.ondeviceorientationabsolute = null;
  if (options.absoluteSensor) context.AbsoluteOrientationSensor = options.absoluteSensor;
  vm.runInNewContext(catalogue,context);
  vm.runInNewContext(script,context);
  const flush = () => {const pending=[...frames.values()];frames.clear();for (const fn of pending) fn();};
  return {
    app:context.app,context,elements,watches,cleared,permissions,
    flush,
    text:id => elements.get(id).textContent,
    async start() {elements.get('start').emit('click');await Promise.resolve();await Promise.resolve();flush();},
    stop() {elements.get('stop').emit('click');flush();},
    position(coords={},id=nextWatch-1,timestamp=now) {
      watches.get(id).success({coords:{latitude:45.123456,longitude:10.654321,accuracy:4.2,altitude:123,altitudeAccuracy:8,...coords},timestamp});
      flush();
    },
    orientation(event={}) {
      const type = event.type ?? 'deviceorientationabsolute';
      context.emit(type,{type,alpha:0,beta:90,gamma:0,absolute:true,...event});
      flush();
    },
    error(code,id=nextWatch-1) {watches.get(id).error({code});flush();},
    advance(ms) {now+=ms;context.tick();flush();},
    visibility(hidden) {document.hidden=hidden;document.emit('visibilitychange');flush();}
  };
}

function close(actual,expected,tolerance=1e-8) {
  assert.ok(Math.abs(actual-expected)<tolerance,`${actual} should be ${expected}`);
}
function vector(actual,expected) {actual.forEach((v,i) => close(v,expected[i]));}

test('startup has no made-up observer or attitude, and mock controls are removed',() => {
  const b = browser();
  assert.equal(b.app.state(),null);
  assert.equal(b.watches.size,0);
  assert.equal(b.context.count('deviceorientationabsolute'),0);
  assert.equal(b.text('site'),'—');
  assert.equal(b.text('lb'),'—');
  assert.doesNotMatch(html,/type="range"|data-target|MOCK OBSERVER|simulated sensor/i);
});

test('equatorial formatting carries seconds/minutes and wraps RA at midnight',() => {
  const {app}=browser();
  assert.equal(app.formatRA(0),'00h 00m 00s');
  assert.equal(app.formatRA(359.99999),'00h 00m 00s');
  assert.equal(app.formatRA(-15),'23h 00m 00s');
  assert.equal(app.formatRA(15*(1+59/60+59.6/3600)),'02h 00m 00s');
  assert.equal(app.formatDec(-16.7161),'−16° 43′');
  assert.equal(app.formatDec(89.9999),'+90° 00′');
});

test('catalogue has real all-sky positions, magnitudes and selected nebulae',() => {
  const {app}=browser();
  assert.equal(app.stars.length,5023);
  const sirius=app.stars.find(s => s.hr===2491);
  close(sirius.ra,101.28708,.00001); close(sirius.dec,-16.71611,.00001);
  assert.equal(sirius.name,'Sirius'); assert.equal(sirius.mag,-1.46);
  for (const star of app.stars) {
    assert.ok(star.ra>=0 && star.ra<360 && Math.abs(star.dec)<=90 && star.mag<6);
    close(Math.hypot(...star.eq),1);
  }
  const orion=app.deepSky.find(o => o.id==='M42');
  close(orion.ra,83.85); close(orion.dec,-5.45);
  assert.equal(orion.kind,'nebula');
});

test('equatorial and local sky transformations agree at poles and across RA zero',() => {
  const {app}=browser();
  for (const star of app.stars.filter((_,i) => i%200===0)) {
    for (const lat of [-90,-45,0,45,90])
      vector(app.enuToEq(app.eqToENU(star.eq,lat,359.9),lat,359.9),star.eq);
  }
  const [ra,dec]=app.equatorial(app.galToEq(0,0));
  close(ra,266.405,.001); close(dec,-28.936,.001);
});

test('rectangular projection keeps the reticle centred in portrait and landscape',() => {
  const {app}=browser();
  const cam={right:[1,0,0],up:[0,1,0],forward:[0,0,1]};
  for (const [width,height] of [[390,844],[844,390]]) {
    Object.assign(app.view,{width,height});
    const centre=app.project([0,0,1],cam);
    close(centre.x,width/2); close(centre.y,height/2);
    const right=app.project([Math.sin(55*Math.PI/180),0,Math.cos(55*Math.PI/180)],cam);
    close(right.x,width/2+195); close(right.y,height/2);
    assert.ok(app.project([0,0,-1],cam).z<0);
  }
});

test('panorama wraps Galactic longitude with north up and centre at l=0',() => {
  const {app}=browser();
  for (const [ray,u,v] of [[[1,0,0],.5,.5],[[0,1,0],.25,.5],[[-1,0,0],0,.5],[[0,-1,0],.75,.5],[[0,0,1],.5,0],[[0,0,-1],.5,1]]) {
    const uv=app.panoramaUV(ray); close(uv[0],u); close(uv[1],v);
  }
});

test('labels avoid the header, coordinate HUD, reticle and one another',() => {
  const {app}=browser(); Object.assign(app.view,{width:390,height:844});
  app.resetLabelBoxes();
  assert.equal(app.reserveLabel(20,30,60,15),false);
  assert.equal(app.reserveLabel(20,740,60,15),false);
  assert.equal(app.reserveLabel(190,420,40,15),false);
  assert.equal(app.reserveLabel(25,220,90,25),true);
  assert.equal(app.reserveLabel(80,235,90,25),false);
  assert.equal(app.reserveLabel(240,290,90,25),true);
});

test('pointing at Sirius reports its equatorial position and clears coordinates on stop',async () => {
  const b=browser(); await b.start(); b.position();
  const {app}=b, observer=app.observerState(), star=app.stars.find(s => s.hr===2491);
  const [az,alt]=app.vectorAltAz(app.eqToENU(star.eq,observer.lat,observer.lst));
  b.orientation({alpha:((app.sensors.field.declination-az)%360+360)%360,beta:90+alt,gamma:0});
  assert.equal(b.text('ra'),'06h 45m 09s');
  assert.equal(b.text('dec'),'−16° 43′');
  assert.equal(b.elements.get('onboarding').hidden,true);
  b.stop(); assert.equal(b.text('ra'),'—'); assert.equal(b.text('dec'),'—');
  assert.equal(b.elements.get('onboarding').hidden,false);
});

test('rear camera faces each cardinal, including zenith and nadir',() => {
  const {app} = browser();
  for (const [alpha,beta,gamma,expected] of [
    [0,90,0,[0,1,0]], [270,90,0,[1,0,0]],
    [180,90,0,[0,-1,0]], [90,90,0,[-1,0,0]],
    [0,0,0,[0,0,-1]], [0,180,0,[0,0,1]],
    [0,60,0,[0,Math.sqrt(3)/2,-.5]],
    [0,120,0,[0,Math.sqrt(3)/2,.5]]
  ]) vector(app.camera({alpha,beta,gamma,northOffset:0},0,0).forward,expected);
});

test('screen rotation compensates landscape and upside-down holding',() => {
  const {app} = browser();
  const portrait = app.camera({alpha:0,beta:90,gamma:0,northOffset:0},0,0);
  // Screen Orientation angles are counterclockwise from natural portrait.
  const landscape = app.camera({alpha:90,beta:0,gamma:-90,northOffset:0},0,90);
  const otherLandscape = app.camera({alpha:270,beta:0,gamma:90,northOffset:0},0,270);
  const upsideDown = app.camera({alpha:180,beta:-90,gamma:0,northOffset:0},0,180);
  for (const cam of [landscape,otherLandscape,upsideDown])
    for (const axis of ['forward','right','up']) vector(cam[axis],portrait[axis]);
});

test('camera basis stays orthonormal across tilt, roll and heading wrap',() => {
  const {app} = browser();
  for (const alpha of [0,.1,90,180,359.9])
    for (const beta of [-179,-90,0,89.9,90,150,179])
      for (const gamma of [-89,0,45,89]) {
        const cam = app.camera({alpha,beta,gamma,northOffset:7},-14,90);
        for (const v of Object.values(cam)) close(Math.hypot(...v),1);
        close(app.dot(cam.forward,cam.right),0);
        close(app.dot(cam.forward,cam.up),0);
        close(app.dot(cam.right,cam.up),0);
      }
});

test('magnetic heading rotates clockwise by east-positive declination',() => {
  const {app} = browser();
  const cam = app.camera({alpha:0,beta:90,gamma:0,northOffset:0},12,0);
  close(app.vectorAltAz(cam.forward)[0],12);
});

// NOAA NCEI WMM2025 test values (public domain), 2025/2027.5,
// sea level / 100 km, northern, equatorial and southern latitudes:
// https://www.ncei.noaa.gov/sites/default/files/2025-02/WMM2025_TEST_VALUES.txt
const wmmCases = [
  [2025,0,80,0,1.28,6523.2], [2025,0,0,120,-.16,39677.9],
  [2025,0,-80,240,68.78,16898.1], [2025,100,80,0,.85,6216.7],
  [2025,100,0,120,-.15,37688.7], [2025,100,-80,240,68.21,15917.1],
  [2027.5,0,80,0,2.59,6507.5], [2027.5,0,0,120,-.24,39702],
  [2027.5,0,-80,240,68.49,16908.3], [2027.5,100,80,0,2.16,6201.1],
  [2027.5,100,0,120,-.23,37711.8], [2027.5,100,-80,240,67.93,15927]
];
test('true north model matches all twelve NOAA reference vectors',() => {
  const {app} = browser();
  for (const [year,alt,lat,lon,declination,horizontal] of wmmCases) {
    const wholeYear = Math.floor(year);
    const start = Date.UTC(wholeYear,0,1);
    const date = new Date(start+(year-wholeYear)*(Date.UTC(wholeYear+1,0,1)-start));
    const result = app.magneticField(lat,lon,alt*1000,date);
    close(result.declination,declination,.006);
    close(result.horizontal,horizontal,.1);
  }
});

test('magnetic model handles geographic poles and refuses expired dates',() => {
  const {app} = browser();
  for (const lat of [-90,90]) {
    const field = app.magneticField(lat,0,0,new Date('2026-10-06'));
    assert.ok(Number.isFinite(field.declination));
    assert.ok(Number.isFinite(field.horizontal));
  }
  assert.equal(app.magneticField(45,10,0,new Date('2030-01-01')),null);
  assert.equal(app.magneticField(45,10,0,new Date('2024-12-31')),null);
});

test('Android absolute orientation and precise location produce a live sky',async () => {
  const b = browser();
  await b.start();
  assert.deepEqual(b.watches.get(0).settings.enableHighAccuracy,true);
  assert.equal(b.watches.get(0).settings.maximumAge,0);
  assert.equal(b.context.count('deviceorientationabsolute'),1);
  b.position();
  assert.equal(b.app.state(),null);
  b.orientation();
  assert.ok(b.app.state());
  assert.match(b.text('latitude'),/45\.123456°N/);
  assert.match(b.text('accuracy'),/±5 m/);
  assert.match(b.text('sensorStatus'),/Tracking live/);
  assert.notEqual(b.text('lb'),'—');
  const before = b.text('aa');
  b.orientation({alpha:270});
  assert.notEqual(b.text('aa'),before);
  assert.equal(b.elements.get('start').hidden,true);
  assert.equal(b.text('compassAccuracy'),'Not reported');
});

test('ordinary absolute events also work; relative events never invent north',async () => {
  const b = browser();
  await b.start();
  b.position();
  b.orientation({type:'deviceorientation',absolute:false});
  assert.equal(b.app.state(),null);
  assert.match(b.text('orientationStatus'),/absolute compass/);
  b.orientation({type:'deviceorientation',absolute:true});
  const reading = b.app.sensors.orientation;
  b.orientation({type:'deviceorientation',absolute:false,alpha:100});
  assert.equal(b.app.sensors.orientation,reading);
});

test('iOS uses the compatible no-argument permission request and anchors compass yaw',async () => {
  const b = browser({permission:() => Promise.resolve('granted')});
  await b.start();
  assert.deepEqual(b.permissions,[undefined]);
  b.position();
  b.orientation({type:'deviceorientation',absolute:false,alpha:123,beta:90,webkitCompassHeading:90,webkitCompassAccuracy:3});
  assert.equal(b.app.state(),null);
  assert.match(b.text('orientationStatus'),/Tilt the phone/);
  b.orientation({type:'deviceorientation',absolute:false,alpha:123,beta:0,webkitCompassHeading:90,webkitCompassAccuracy:3});
  b.orientation({type:'deviceorientation',absolute:false,alpha:123,beta:90,webkitCompassHeading:90,webkitCompassAccuracy:3});
  const state = b.app.state();
  close(b.app.vectorAltAz(state.camera.forward)[0],90+b.app.sensors.field.declination);
  assert.match(b.text('compassAccuracy'),/±3.0°/);
  b.orientation({type:'deviceorientation',absolute:false,webkitCompassHeading:0,webkitCompassAccuracy:-1});
  assert.equal(b.app.state(),null);
  assert.match(b.text('orientationStatus'),/calibration/);
});

test('null/invalid angle events cannot become a compass reading',async () => {
  const b = browser();
  await b.start();b.position();
  for (const invalid of [{alpha:null},{beta:null},{gamma:NaN}]) b.orientation(invalid);
  assert.equal(b.app.state(),null);
  b.orientation();assert.ok(b.app.state());
});

test('permissions denied, unsupported sensors, and insecure origins show guidance',async () => {
  const denied = browser({permission:() => Promise.resolve('denied')});
  await denied.start();denied.error(1);
  assert.match(denied.text('orientationStatus'),/No sensor readings yet/);
  assert.doesNotMatch(denied.text('orientationStatus'),/denied/);
  assert.match(denied.text('locationStatus'),/permission denied/);
  assert.equal(denied.app.state(),null);
  const unsupported = browser({noLocation:true,noOrientation:true});
  await unsupported.start();
  assert.match(unsupported.text('locationStatus'),/does not support/);
  assert.match(unsupported.text('orientationStatus'),/does not support/);
  const insecure = browser({secure:false});
  await insecure.start();
  assert.equal(insecure.watches.size,0);
  assert.equal(insecure.elements.get('start').disabled,true);
  assert.match(insecure.text('sensorStatus'),/HTTPS/);
});

test('blocked motion permission does not prevent location and can be retried',async () => {
  let denied = true;
  const b = browser({permission:() => denied ? Promise.reject(new Error('blocked')) : Promise.resolve('granted')});
  await b.start();b.position();
  assert.match(b.text('orientationStatus'),/could not complete/);
  assert.equal(b.text('latitude'),'45.123456°N');
  denied = false;
  await b.start();b.orientation();
  assert.ok(b.app.state());
  assert.equal(b.context.count('deviceorientationabsolute'),1);
  assert.deepEqual(b.cleared,[0]);
});

test('timeout/unavailable location keeps watching and accepts a later fix',async () => {
  const b = browser();
  await b.start();b.error(3);
  assert.match(b.text('locationStatus'),/timed out/);
  b.error(2);assert.match(b.text('locationStatus'),/unavailable/);
  b.position();b.orientation();
  assert.ok(b.app.state());
  b.position({accuracy:500});
  assert.match(b.text('sensorStatus'),/approximate/);
});

test('quiet orientation holds the last view with its age; a stale location clears the sky',async () => {
  const b = browser();
  await b.start();b.position();b.orientation();
  b.advance(6000);
  assert.ok(b.app.state());
  assert.notEqual(b.text('lb'),'—');
  assert.equal(b.text('orientationTime'),'6 s ago');
  assert.match(b.text('orientationStatus'),/Holding the last attitude/);
  b.orientation();assert.ok(b.app.state());
  b.advance(120000);b.orientation();
  assert.equal(b.app.state(),null);
  assert.match(b.text('locationStatus'),/stale/);
  b.position();assert.ok(b.app.state());
});

test('a null absolute reading invalidates an existing compass pose',async () => {
  const b = browser();
  await b.start();b.position();b.orientation();
  b.orientation({alpha:null,beta:null,gamma:null});
  assert.equal(b.app.state(),null);
  assert.equal(b.text('aa'),'—');
  assert.match(b.text('orientationStatus'),/unavailable/);
});

test('background pauses sensors; return resumes without duplicates or an old callback',async () => {
  const b = browser();
  await b.start();b.position();b.orientation();
  b.visibility(true);
  assert.deepEqual(b.cleared,[0]);
  assert.equal(b.context.count('deviceorientationabsolute'),0);
  assert.equal(b.app.state(),null);
  b.visibility(false);
  assert.equal(b.watches.size,2);
  assert.equal(b.context.count('deviceorientationabsolute'),1);
  b.position({latitude:1},0);
  assert.equal(b.app.sensors.location.lat,45.123456);
  b.orientation();assert.ok(b.app.state());
  b.stop();
  assert.deepEqual(b.cleared,[0,1]);
  assert.equal(b.app.sensors.location,null);
  assert.equal(b.context.count('deviceorientation'),0);
  b.position({},1);b.orientation();
  assert.equal(b.app.state(),null);
});

test('stopping during a permission prompt cannot restart the sensors',async () => {
  let resolve;
  const b = browser({permission:() => new Promise(done => {resolve=done;})});
  await b.start();b.stop();
  resolve('granted');
  await Promise.resolve();await Promise.resolve();b.flush();
  assert.equal(b.context.count('deviceorientationabsolute'),0);
  assert.equal(b.app.sensors.active,false);
});

test('a denied permission-method result cannot suppress delivered sensor readings',async () => {
  const b = browser({absoluteEvents:true,permission:() => Promise.resolve('denied')});
  await b.start();b.position();
  assert.deepEqual(b.permissions,[undefined,true]);
  assert.equal(b.context.count('deviceorientationabsolute'),1);
  b.orientation({alpha:270,beta:120});
  assert.ok(b.app.state());
  assert.match(b.text('aa'),/30.0°$/);
  assert.notEqual(b.text('rollReading'),'—');
  assert.match(b.text('sensorStatus'),/Tracking live/);
  assert.doesNotMatch(b.text('orientationStatus'),/denied|permission request/);
});

test('blocked compass access still allows live tilt and roll without inventing heading',async () => {
  const b = browser({absoluteEvents:true,permission:absolute => Promise.resolve(absolute ? 'denied' : 'granted')});
  await b.start();b.position();
  b.orientation({type:'deviceorientation',absolute:false,alpha:237,beta:120,gamma:20});
  assert.equal(b.app.state(),null);
  assert.match(b.text('aa'),/^— \/ \d/);
  assert.notEqual(b.text('rollReading'),'—');
  assert.match(b.text('orientationStatus'),/Tilt and roll are available/);
  assert.doesNotMatch(b.text('orientationStatus'),/denied/);
  assert.equal(b.text('lb'),'—');
});

test('relative tilt/roll can be read before GPS or north is available',async () => {
  const b = browser();
  await b.start();
  b.orientation({type:'deviceorientation',absolute:false,alpha:null,beta:90,gamma:0});
  assert.equal(b.text('aa'),'— / -0.0°');
  assert.equal(b.text('rollReading'),'0.0°');
  assert.equal(b.app.state(),null);
});

test('sensor data arriving during a permission prompt outranks its later result',async () => {
  let resolve;
  const b = browser({permission:() => new Promise(done => {resolve=done;})});
  await b.start();b.position();b.orientation();
  assert.ok(b.app.state());
  resolve('denied');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();b.flush();
  assert.ok(b.app.state());
  assert.doesNotMatch(b.text('orientationStatus'),/permission request/);
});

test('an unavailable parallel absolute stream cannot erase a working Safari compass',async () => {
  const b = browser();
  await b.start();b.position();
  b.orientation({type:'deviceorientation',absolute:false,beta:60,webkitCompassHeading:0,webkitCompassAccuracy:3});
  const reading=b.app.sensors.orientation;
  b.orientation({alpha:null,beta:null,gamma:null});
  assert.equal(b.app.sensors.orientation,reading);
  assert.ok(b.app.state());
});

test('Chromium quaternion readings work even if legacy permission requests fail',async () => {
  let sensor;
  class AbsoluteSensor {
    constructor(settings) {this.settings=settings;this.handlers=new Map();sensor=this;}
    addEventListener(type,fn) {this.handlers.set(type,fn);}
    start() {this.started=true;}
    stop() {this.stopped=true;}
    emit(type) {this.handlers.get(type)();}
  }
  const b=browser({absoluteSensor:AbsoluteSensor,permission:() => Promise.resolve('denied')});
  await b.start();b.position();
  assert.equal(sensor.started,true);
  assert.equal(sensor.settings.referenceFrame,'device');
  const k=Math.SQRT1_2;
  sensor.quaternion=[k,0,0,k];sensor.emit('reading');b.flush();
  assert.ok(b.app.state());
  close(b.app.vectorAltAz(b.app.state().camera.forward)[0],b.app.sensors.field.declination);
  close(b.app.vectorAltAz(b.app.state().camera.forward)[1],0);
  assert.equal(b.text('rollReading'),'0.0°');
  b.orientation({alpha:null,beta:null,gamma:null});
  assert.ok(b.app.state());
  b.visibility(true);
  assert.equal(sensor.stopped,true);
  assert.equal(b.app.sensors.absoluteSensor,null);
});

test('a Generic Sensor error preserves a working legacy orientation stream',async () => {
  let sensor;
  class AbsoluteSensor {
    constructor() {sensor=this;this.handlers=new Map();}
    addEventListener(type,fn) {this.handlers.set(type,fn);}
    start() {}
    stop() {this.stopped=true;}
  }
  const b=browser({absoluteSensor:AbsoluteSensor});
  await b.start();b.position();b.orientation();
  const reading=b.app.sensors.orientation;
  sensor.handlers.get('error')();b.flush();
  assert.equal(b.app.sensors.orientation,reading);
  assert.ok(b.app.state());
  assert.equal(sensor.stopped,true);
});
