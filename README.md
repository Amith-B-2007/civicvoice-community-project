# CivicVoice: Digital Suggestion Box for Local Governance

A website where residents submit suggestions, problems and feedback on civic matters to their local governing body, support each other's ideas, and see the council's replies in public. It covers a whole state (set up for Karnataka's 31 districts) and works in English, Kannada and Hindi.

## Run it

Needs [Node.js](https://nodejs.org) 22.13 or newer. There is nothing to install.

```bash
npm start
```

Open http://localhost:3000.

| Command | What it does |
|---|---|
| `npm start` | Starts the site on this computer only |
| `npm run lan` | Starts it so phones on the same Wi-Fi can open it (the address is printed) |
| `npm run seed` | Adds sample submissions, polls, notices and two officer accounts. Safe to run again |
| `npm run reset-admin` | Creates a new admin login if the password is lost |

To put the site on the internet, follow [DEPLOY.md](DEPLOY.md).

## Features

**For residents**
- Submit a suggestion, problem or feedback without an account, optionally anonymous
- English, Kannada and Hindi, switched from the bar at the top of every page
- Speak the details instead of typing (voice input)
- Choose the district and type the city, town or village; the ward or area is optional
- Pin the exact location: "Use my current location" (GPS) or tap the map, then drag the pin. The address, town and district are filled in from the pin
- Attach a photo (shrunk in the browser before upload)
- Get a tracking code and follow progress on the Track page
- See similar existing suggestions while typing a title
- Browse, search, filter (by district too) and sort everything; support (vote for) and comment
- Map of all pinned submissions across the state, coloured by status; picking a district zooms to it
- "Is this really fixed?": confirm or dispute work the council marked as implemented
- Vote in council polls; read the notice board
- Report spam or abuse on a submission or a comment
- Public dashboard: response rate, overdue count, residents' confirmation rate, charts
- Dark mode and larger text

**For officials** (`/admin`)
- Two roles: the admin sees everything; an officer sees only their department, and can also be limited to one district
- Submissions are sent to a department automatically from their category, and can be passed on
- Change status, publish a public reply, attach a photo of the work (shown as before and after)
- Tiles for what needs attention: overdue, reported by residents, marked done but disputed
- Hide spam, delete comments, dismiss reports
- Create and close polls; publish notices; create officer accounts and reset their passwords
- Printable monthly report for council meetings (`/report`)
- Printable QR code poster that opens the submit page (`/poster`)
- Export to CSV (opens in Excel)

## Official logins

The first start creates an account named `admin` with a random password and saves both in `data/admin-credentials.txt`. Sign in at `/admin`, then use **Change password**.

`npm run seed` also creates two sample officers (`roads` and `health`). Their passwords are in `data/sample-officer-logins.txt`. The admin can add real officers from the **Officers** tab.

## Settings

Edit `config.json` and restart the server:

| Setting | Meaning |
|---|---|
| `siteName`, `tagline`, `bodyName` | Names shown on every page. Each can be plain text or `{ "en": ..., "kn": ..., "hi": ... }` |
| `region` | The state the site covers, shown under the site name |
| `districts` | Each district's `id`, `label` (three languages), `center` `[latitude, longitude]` and optional `aliases` (other spellings and big towns, so the address lookup can match them) |
| `map.center`, `map.zoom` | Where maps open before a district is chosen. Set to show the whole state |
| `departments` | Departments that handle submissions |
| `categories` | Topic id, icon, label and the department it goes to |
| `overdueDays` | Days without a first response before a submission counts as overdue |
| `publicUrl` | The site's public address, used on the QR poster once the site is hosted |
| `port` | The port the site runs on |

To use the site for another state, change `region`, `districts` and `map`, then delete the `data` folder and run `npm run seed`. The sample submissions use Karnataka districts, so remove them from `seed.js` or skip the seed.

These environment variables are for hosting (see [DEPLOY.md](DEPLOY.md)):

| Variable | Meaning |
|---|---|
| `PORT` | The port to listen on (set by the hosting service) |
| `HOST` | `0.0.0.0` to accept connections from outside this computer |
| `DATA_DIR` | Folder for the database and photos, for example a persistent volume |
| `TRUST_PROXY` | Number of proxies in front of the site (usually `1`), so rate limits use each visitor's real address |
| `ADMIN_PASSWORD` | Password for the first `admin` account instead of a random one (8 characters or more) |

Translations are in `i18n/en.json`, `i18n/kn.json` and `i18n/hi.json`. A key missing from Kannada or Hindi falls back to English. The officials' pages are in English only.

## How it is built

| Part | Technology |
|---|---|
| Server | Node.js built-in `http` module, no frameworks or npm packages |
| Database | SQLite through Node's built-in `node:sqlite` |
| Pages | HTML, CSS and plain JavaScript |
| Maps | [Leaflet](https://leafletjs.com) with OpenStreetMap tiles; address lookup by OpenStreetMap Nominatim |
| QR code | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) |
| Voice input | The browser's Web Speech API |

```
server.js          Starts the site: pages, static files, templating, security headers
src/public-api.js  API used by residents
src/admin-api.js   API used by officials (roles and department limits are enforced here)
src/db.js          Database tables and every SQL query
src/auth.js        Official login: password hashing, sessions, roles
src/i18n.js        Language handling
src/labels.js      Status and type names in three languages
src/util.js        Validation, rate limiting, CSV
views/             One HTML file per page, plus shared header and footer
public/css, js     Styles and browser scripts (one script per page)
public/vendor      Leaflet and the QR code library, copied in so they work offline
i18n/              Translated text
seed.js            Sample data
config.json        Site settings
data/              The database and login files (created on first run)
uploads/           Photos (created on first run)
```

Database tables: `suggestions`, `votes`, `comments`, `updates` (status changes, replies, photos), `confirmations` ("is it fixed?" answers), `reports`, `polls`, `poll_options`, `poll_votes`, `notices`, `admins`, `sessions`.

## Safety measures

- User text is always inserted as text, never as HTML, and a Content Security Policy blocks inline scripts
- All SQL uses parameters
- Passwords are hashed with scrypt; the session cookie is HttpOnly and SameSite=Strict
- Submissions, comments, votes, reports and sign-in attempts are rate limited per IP address
- Uploaded photos are checked to be real JPEG or PNG files and are stored under random names
- Contact details and abuse reports are only sent to signed-in officials
- Officers are limited to their own department (and district, if set) on the server, not just in the page

## Known limits

- **GPS and voice input need a secure address.** Browsers allow them only on `https://` sites and on `localhost`. On a phone using the `npm run lan` address they are blocked, so the pin must be placed by tapping the map. Hosting the site with https removes this limit.
- Voice input works in Chrome and Edge and needs an internet connection. The button is hidden in browsers without it.
- Map tiles and the address lookup need an internet connection. The rest of the site works offline.
- One vote per browser, not per person. Clearing browser data allows another vote. Verifying people (for example by phone OTP) would fix this.
- No email or SMS is sent; residents check progress with their tracking code.
- Submissions appear publicly at once and are moderated afterwards.
- The Kannada and Hindi text should be read once by a native speaker before real use.
- To start with an empty database, stop the server and delete the `data` and `uploads` folders.

## Ideas for later

- OTP verification for voting
- Email or SMS alerts when the status changes
- Kannada and Hindi for the officials' pages
- A phone app wrapper (PWA) with offline drafts
