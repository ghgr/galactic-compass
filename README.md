# Galactic Compass

Open the page on a phone, tap **Enable sensors**, and allow precise location
and motion/compass access. Point the back of the phone toward the sky. The
view uses the rear camera direction, with tilt, roll, and screen rotation.
On iOS, briefly tilt the phone toward horizontal to establish the compass
reference before pointing at the sky.

The sky fills the viewport in portrait or landscape. Tap the four-corner
icon at the top right to enter browser fullscreen; tap again to leave it.
The adjacent settings button opens the sensor details and sky layers.
The coordinate HUD shows the centre ray's RA (hours, minutes, seconds),
Dec (degrees, arcminutes), and Galactic longitude/latitude. These use an
approximate J2000 frame for visual navigation, not precision astrometry.

The scene combines a spherical projection of the real
[Milky Way panorama by ESO/S. Brunier](https://www.eso.org/public/images/eso0932a/)
with 5,023 catalogue stars brighter than visual magnitude 6 and 13 selected
nebulae, clusters, and galaxies. Object positions follow the same sky geometry
as the Galactic axes. Labels avoid one another and the HUD, with at most four
object labels on phones or six on larger screens. The Galactic plane and
local horizon are subtle; the full coordinate grid is optional.

Imagery is an enhanced, historical sky atlas rather than a camera feed.
Most nebulae are much fainter to the unaided eye. The panorama can include
planets photographed in 2009; current planetary positions are not calculated.
The atlas shows directions below the horizon, with an explicit indicator.
All assets are served locally. WebGL reprojects the panorama; browsers that
disable it use a bounded-resolution CPU fallback with sharp catalogue stars
and readouts. The settings drawer can disable imagery and labels separately.

`assets/milky-way.jpg` is the ESO panorama resized to 2048 × 1024 and rendered
with adjusted brightness, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The required **ESO/S. Brunier** credit is visible in the sky view.
`assets/sky-catalog.js` contains J2000 positions, visual magnitudes, and B−V
colours from the [Yale Bright Star Catalogue, V/50 (Hoffleit et al., 1991)](https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50),
retrieved through VizieR with `Vmag < 6.0` and valid coordinates. The selected
deep-sky positions and diameters come from the
[NASA HEASARC Messier catalogue](https://heasarc.gsfc.nasa.gov/W3Browse/catalog/messier.html).

The observer position comes from a high accuracy geolocation watch. Actual
accuracy depends on the phone and the permissions granted; the page displays
the reported accuracy. The phone must provide a compass heading; relative
gyro readings alone cannot align the Galactic sky. Location is never uploaded
or saved. Sensors pause when the page is hidden.

The page listens to ordinary and absolute orientation events and, when
available, Chromium's `AbsoluteOrientationSensor` quaternion API. Sensor
readings are accepted independently of a permission method's return value.
Tilt and roll remain visible when only relative orientation is available;
the Galactic sky requires a north reference. Basic motion access and optional
compass access are requested separately on browsers that support both.

Magnetic headings are corrected to geographic north using the embedded,
public-domain NOAA/BGS WMM2025 coefficients. The model is valid through 2029
and must be updated afterward. Quiet orientation streams retain the last
attitude and show its age. Unavailable compass readings or a location fix
older than two minutes suspend the sky projection.

## GitHub Pages

The `main` branch contains the application, local HTTPS server, and tests.
The `deployment` branch contains the static site at its root: `index.html`,
`assets/`, and `.nojekyll`. It requires no build step or Python server.

After pushing the branches yourself, open the repository's **Settings → Pages**,
select **Deploy from a branch**, choose **deployment** and **/(root)**, and save.
See [GitHub's publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
The project URL will be `https://ghgr.github.io/galactic-compass/`.
The relative asset paths support this project subdirectory, and GitHub's HTTPS
hosting supplies the secure context required for phone sensors.

The deployment branch is a snapshot. For future releases, copy the updated
`index.html` and `assets/` from `main` into `deployment`, retain `.nojekyll`,
and commit the changes there before pushing that branch.

## Local HTTPS server

HTTPS is required on a phone. This workspace is serving the page at
`https://0.0.0.0:20000` (all IPv4 interfaces), using a self-signed certificate.
Connect using the server's reachable IP address, for example
`https://10.44.209.199:20000`. If the phone blocks sensor access because of
the certificate, install and trust the public `galactic-compass.crt` on it.
The private key is outside the served directory.

To restart the server in this workspace:

```sh
python3 /work/galactic-compass/serve.py \
  --host 0.0.0.0 --port 20000 \
  --cert /work/.galactic-compass-https/server.crt \
  --key /work/.galactic-compass-https/server.key
```

The running server's PID and log are in
`/work/.galactic-compass-https/server.pid` and `server.log`.
The certificate includes the current server IPv4 addresses and expires after
one year; regenerate it if the address changes or it expires.

Run the sensor/math regression checks with Node.js 18 or newer:

```sh
node --test tests/sensors.test.mjs
```

These checks cover both Android absolute orientation and iOS compass anchoring,
screen rotation, permission failures with working sensor streams, independent
tilt/roll readings, the quaternion API, lifecycle recovery, and NOAA's twelve
WMM2025 reference vectors. Hardware sensor accuracy still needs verification
on the phone being used.
The astronomy checks also cover catalogue coordinates, RA/Dec rounding,
equatorial/local transforms, rectangular projection, panorama orientation,
label collisions, and pointing the centre ray at Sirius.
