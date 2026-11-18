# Putting CivicVoice online

There are two ways:

| | A. Railway (recommended) | B. Free, from your laptop |
|---|---|---|
| Online | All the time | Only while your laptop is on and the commands are running |
| Address | Fixed, like `https://civicvoice.up.railway.app` | Changes every time, like `https://some-words.trycloudflare.com` |
| Cost | About $5 a month (Hobby plan) | Free |
| Good for | Real use by residents and officials | A demo, viva or presentation |

Both give an `https://` address, so "Use my current location" and voice input also work on phones.

---

## A. Railway

### 1. Create an account

Sign up at https://railway.com ("Sign in with GitHub" is easiest) and choose the **Hobby** plan.

### 2. Install the Railway tool

Open a terminal in the project folder (in VS Code: **Terminal → New Terminal**) and run:

```bash
npm install -g @railway/cli
```

```bash
railway login
```

The second command opens the browser so you can confirm the login.

### 3. Upload the code

```bash
railway init
```

Give the project a name, for example `civicvoice`. Then:

```bash
railway up
```

This uploads the folder and starts the site. The `data` and `uploads` folders are **not** uploaded, so the online site starts empty: none of your test submissions or local logins go online.

The first start may show "Application failed to respond". That is expected until steps 4 and 5 are done.

### 4. Settings

Open the project at https://railway.com/dashboard, click the service, then **Variables → Raw Editor**, and paste this (choose your own password on the last line):

```
HOST=0.0.0.0
DATA_DIR=/data
TRUST_PROXY=1
ADMIN_PASSWORD=choose-a-long-password
```

| Setting | Why |
|---|---|
| `HOST=0.0.0.0` | Lets Railway reach the site (by default it only answers on the same computer) |
| `DATA_DIR=/data` | Keeps the database and photos on the storage volume from step 5 |
| `TRUST_PROXY=1` | Reads each visitor's real address, so the spam limits apply per person and not to everyone together |
| `ADMIN_PASSWORD` | The password of the `admin` account, used only when the site starts for the first time |

Optional: in the service's **Settings → Region**, pick **Southeast Asia (Singapore)** so pages load faster in India. Do this before step 5.

### 5. Storage

Without this, every submission and photo is deleted each time the site is updated.

On the project canvas press **Ctrl+K** (or right-click the empty canvas), choose **Volume**, select the service and set the mount path to:

```
/data
```

Then click **Deploy** on the banner at the top to apply the changes.

### 6. Web address

Click the service → **Settings → Networking → Generate Domain**. You get an address like `https://civicvoice.up.railway.app`. That is the site; share it and print the QR poster from `/poster`.

### 7. First sign-in

1. Open `https://<your address>/admin` and sign in as `admin` with the `ADMIN_PASSWORD` from step 4.
2. Click **Change password** and choose a new one. You can then delete the `ADMIN_PASSWORD` variable; it is only used when no admin exists yet.
3. Add officer accounts from the **Officers** tab.

### Updating the site later

Changes you make on your computer (pages, design, text, translations, `config.json`) do **not** reach the online site by themselves. When you are happy with them, run this again in the project folder:

```bash
railway up
```

The online site updates in a minute or two. Submissions, photos and logins on the volume are kept.

What people do **on** the website (new submissions, votes, replies, polls, notices, officer accounts) shows up online at once with no upload. That data lives only on the server; your computer's copy has its own separate test data.

### If something goes wrong

- **"Application failed to respond"**: check that `HOST=0.0.0.0` is set and that the latest deploy finished.
- **See what the server says**: the service's **Deployments → View logs**, or run `railway logs`.
- **Admin password lost**: set a new `ADMIN_PASSWORD` variable, then run `railway ssh` and inside it `npm run reset-admin`.

---

## B. Free, from your laptop

1. Install Cloudflare's tunnel tool (once):

   ```bash
   winget install --id Cloudflare.cloudflared
   ```

2. Start the site in PowerShell:

   ```powershell
   $env:TRUST_PROXY=1; npm start
   ```

3. In a **second** terminal:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

4. It prints an address like `https://some-words.trycloudflare.com`. Anyone can open it while both terminals keep running.

The data stays on your laptop, so people see your local submissions, including the sample ones. Close the terminals to take the site offline.
