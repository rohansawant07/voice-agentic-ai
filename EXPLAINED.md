# Roam, explained in plain English

This page explains what Roam is, how it works, every tool it uses, and everything done so far, from the first line of code to putting it on the internet. No technical background needed. Words in *italics* are explained in the [glossary](#glossary) at the end.

Last updated: October 27, 2026.

---

## 1. What Roam is

Roam is a travel-planning assistant for trips inside the United States and its territories (like Puerto Rico).

You tell it, by typing or by talking, something like *"Plan a long weekend at Lake George for six people over Thanksgiving."* Roam asks a question or two if needed. Then it researches and fills a **trip board** on the screen with:

- flight options,
- places to stay,
- rental cars,
- a day-by-day plan,
- and, when asked, a budget breakdown.

It is a **prototype**: a working demonstration, not a real travel agency. It cannot book or pay for anything.

---

## 2. How it works, step by step

Here is what happens when you ask Roam for a trip:

1. **You speak or type.** If you speak, your voice recording is sent to a service called **Deepgram**, which turns speech into text. From then on, voice and typing are treated exactly the same.
2. **The "manager" reads your request.** Roam's main AI (Claude Opus) acts like a team lead. It figures out what is needed: flights? hotels? a day plan?
3. **It hands out jobs to specialists.** There are six smaller, cheaper AIs (Claude Haiku), each with one job: **flights, places to stay, rental cars, itinerary (day plans), budget, and bookings**. Several of them work at the same time.
4. **Each specialist can only use its own tools.** For example, the flights specialist can only search flights; it can't look up the weather. Each tool returns real facts or clearly labeled sample data. The specialists are told never to make things up.
5. **Results stream onto your screen as they arrive.** You can watch each specialist work in the **Planning activity** tab.
6. **The manager writes the reply.** It summarizes everything in a short, friendly answer and asks what you'd like next.
7. **You pick and compare.** Tapping a flight, a stay and a car adds them up into an **estimated total**, compared with the budget you mentioned. Nothing is booked.

---

## 3. What's real and what's pretend

Being honest about this is a core rule of the project.

| Information | Where it comes from | Real or sample? |
| --- | --- | --- |
| Flights, hotels, rental cars | Sample data written into the project | **Sample** (labeled as such on screen) |
| Bookings, refunds, support tickets | Sample data | **Sample** |
| Things to do (most US places) | **Wikivoyage**, a free travel guide written by volunteers | Real, but community-written: check hours |
| Harpers Ferry and Shenandoah | Hand-written guides from the National Park Service | Real |
| Weather forecasts and typical weather | **Open-Meteo**, a free weather service | Real |
| Current facts (closures, events) | **Web search** through Anthropic | Real, with source links |
| Airbnb stays | A ready-made Airbnb search link | Real link; Roam can't see the listings or prices |
| Speech to text | **Deepgram** | Real |

So: **the day plans, weather and web facts are real; the prices for flights, hotels and cars are pretend.** Real prices would need a paid travel data company.

---

## 4. Everything that's used, and what each part does

### The app you see

| Tool | What it is | Its job in Roam |
| --- | --- | --- |
| **Next.js** and **React** | Popular tools for building websites | Draws the chat, the trip board and all the buttons |
| **TypeScript** | JavaScript with extra checks for mistakes | The language almost all of Roam is written in |
| **Browser storage** | A small memory inside your web browser | Remembers your trip if you refresh the page |

### The behind-the-scenes "brain"

| Tool | What it is | Its job in Roam |
| --- | --- | --- |
| **Claude Opus 4.8** (Anthropic) | A powerful AI model | The manager: understands you, assigns work, writes replies |
| **Claude Haiku 4.5** (Anthropic) | A smaller, cheaper, faster AI model | The six specialists, plus web research |
| **Claude Sonnet 5** (Anthropic) | A mid-sized AI model | The "grader" that checks itinerary quality in tests (not used for live users) |
| **AI SDK** | A free code library | Lets Roam talk to Claude and hand it tools |
| **Fastify** | A tool for building web servers | Receives your messages and streams results back |
| **WebSockets** | A live, always-open connection | Pushes each update to your screen the moment it happens |
| ***MCP*** | A standard way to give AIs tools | Packages Roam's tools into three small services: travel, weather and agency |

### Outside services Roam talks to

| Service | Job | Cost |
| --- | --- | --- |
| **Anthropic** (Claude) | Thinking and web search | Paid per use, from your Anthropic credits |
| **Deepgram** | Turns your voice into text | Paid per use, from your Deepgram credits |
| **Open-Meteo** | Weather and locating places on a map | Free, no key needed |
| **Wikivoyage** | Things to do, sights and restaurants | Free, no key needed |
| **Airbnb** | Only a search link is created | Free |
| **OpenAI / ElevenLabs** | Optional: reads replies out loud | Not set up right now |

### Storing information

| Tool | What it is | Its job |
| --- | --- | --- |
| **PostgreSQL** | A database (an organized, permanent filing cabinet) | Keeps conversations and activity so they survive restarts and can be shared between servers |

### Packaging and running it

| Tool | What it is | Its job |
| --- | --- | --- |
| **Docker** | Puts each part of the app in its own sealed box (a *container*) | Makes the app run the same way on any computer |
| **Docker Compose** | A recipe that starts all the boxes together | Starts all of Roam's parts (eight on AWS) with one command |
| **nginx** | A *gateway* program | Asks for a username and password, limits how fast anyone can send requests, and routes traffic |
| **Caddy** | Another gateway program | Gives the website a secure **https://** address and gets its security certificate automatically |
| **Let's Encrypt** | A free certificate authority | Issues the certificate that puts the padlock in your browser |
| **sslip.io** | A free naming service | Gives the server a web address without buying a domain name |

### Amazon Web Services (AWS): where it lives online

| AWS service | Plain-English meaning | Its job |
| --- | --- | --- |
| **EC2 t4g.small** | One rented computer in Amazon's data center (2 GB memory, energy-efficient ARM chip) | Runs all of Roam. Free under an AWS trial until December 31, 2026 |
| **Elastic IP** | A permanent internet address for that computer | Keeps the web address the same even after restarts |
| **EBS volume** | The computer's hard drive (20 GB, encrypted) | Stores the app and the database; kept even if the server is deleted |
| **Data Lifecycle Manager** | An automatic backup scheduler | Takes a snapshot of the drive every day and keeps seven |
| **Parameter Store** | A locked safe for passwords and keys | Holds the API keys and passwords, encrypted, outside the code |
| **Session Manager** | Remote control without opening a door | Lets updates be run on the server without SSH |
| **CloudFormation** | A blueprint that builds everything in one go | Creates (and can delete) every AWS piece above from one file |
| **IAM** | Permissions | Gives the server permission to read only Roam's secrets, nothing else |
| **AWS Budgets** | Spending alerts | Emails you if monthly AWS costs pass 80% of $10 |

### Checking quality

| Tool | Job |
| --- | --- |
| **Automated tests** (Node's built-in test runner) | 25+ small checks that run in seconds, with no internet or AI needed |
| **ESLint** and **TypeScript checks** | Catch coding mistakes before they run |
| **GitHub Actions** | Runs those checks automatically every time code is pushed |
| **Itinerary evaluation** | A paid test where Claude Sonnet grades whether day plans stick to their sources |
| **cfn-lint** and **shellcheck** | Check the AWS blueprint and setup scripts for mistakes |

---

## 5. The story so far

### August 21–25, 2026: the first version ("Concierge")
- Wrote the plan: which AI does what, and what it might cost.
- Built the basic structure: shared rules for what each piece of data looks like.
- Built the three tool services: **travel** (sample flights, hotels, cars, activities), **weather** (real forecasts), and **agency** (sample bookings and support tickets).
- Built the manager AI and the six specialists, and had them work in parallel.
- Added **voice**: speak, see your words appear, optionally hear replies.
- Built the first website, then fixed early voice bugs and tightened security (which websites may connect, and listening only on the local computer by default).
- Added dietary needs (vegan, gluten-free and so on) and rental cars only when they're relevant.

### October 22–26: making it solid, and naming it **Roam**
- Protected conversation history and checked every incoming message for problems.
- Named the app **Roam** and redesigned it: a conversation on the left, a visual trip board on the right.
- Measured real speed: about 2 seconds for a quick question, about 17 seconds for a day plan, about 38 seconds for a full multi-specialist trip.
- Packaged everything with **Docker**, added the **database**, and put a password-protected **gateway** in front. It runs privately on this laptop at `http://localhost:3080`.

### October 27: today's big round of improvements
1. **New trip board design.** It adds:
   - a dark summary card (route, dates, travelers, your picks and the estimated total against your budget),
   - side-by-side comparisons with labels like *Cheapest* and *Fastest*, worked out from the options shown,
   - loading placeholders that say what's being searched,
   - one tab per day for the itinerary,
   - a timeline of what each specialist did,
   - suggested follow-up replies, a **New trip** button and **Copy plan**.

   Trips also survive a page refresh, and the screen reconnects by itself if the connection drops.
2. **Day plans for (almost) anywhere in the US.** A real request for Lake George failed with "data coverage gaps". Roam only knew two places in detail. Now it reads **Wikivoyage** listings for any US place, and the code itself removes places that say they're closed on your dates. In the Lake George test, it correctly skipped a museum that's closed November to April.
3. **Better weather.** Places are found by state ("Lake George, NY", not the one in Minnesota), San Juan is found in Puerto Rico, and trips more than 16 days away get typical weather from the last three years.
4. **Web search for every AI.** Each specialist and the manager can look things up online, at most twice per job, always with source links. Tested live: it correctly found that Harpers Ferry park is **closed on Thanksgiving Day**, confirmed on the official park website.
5. **A quality grader, then a fix.** An automatic test where a stronger AI grades the day plans found that they renamed places, merged them, invented stops, and added unsupported details. A new safety check in the code now does several things:
   - restores exact place names,
   - removes invented or closed stops,
   - keeps days inside your trip dates,
   - writes descriptions from the listing itself when there's no text to go on.

   On a rerun, one of four test trips passed (up from none), and unsupported details per stop fell by about 40%. Some wording on community listings still gets embellished.
6. **Putting it on the internet (AWS).** Wrote a one-command deploy kit and tested it on this Mac. Then switched it to the cheapest option, the free **t4g.small** trial, which brought the estimate from about $21 to about $6 a month. Then deployed it (see the next section).

Every change was recorded in [EXECUTION.md](EXECUTION.md) and pushed to GitHub.

---

## 6. The deployment

**Status: live** since October 27, 2026 at **https://98-95-105-10.sslip.io**. It's password-protected; the username and password are in `.secrets/aws-tester-login.txt` on this laptop.

What happened during deployment:
1. Installed the AWS command-line tool on this Mac and signed in to the AWS account.
2. **First attempt failed.** AWS rejected the backup schedule because its description contained a comma, which that field doesn't allow. AWS automatically undid everything; we checked that nothing billable was left behind.
3. Removed the comma and deployed again. This time it worked.
4. The new server installed Docker and built the whole app itself. From switch-on to the site answering took **about 19 minutes**.

What was checked on the live site:
- The padlock certificate is real: issued by Let's Encrypt, valid until January 25, 2027.
- `http://` addresses redirect to the secure `https://` address.
- Visitors without the password, or with a wrong one, are turned away. The correct login gets in.
- A real trip request (one day at Harpers Ferry) worked over the internet in about 22 seconds, with live updates streaming to the screen.
- AWS shows exactly what was planned:
  - one t4g.small server with standard CPU credits,
  - a 20 GB encrypted drive kept on deletion,
  - daily backups switched on,
  - only the two web ports open.
- The $10 budget alert is set up and emails rohsaw404@gmail.com.

> Note: this AWS account showed no Free Plan credits, so the ~$6/month below is real spending. The server itself is still free under the t4g trial until December 31, 2026.

### What it costs

| Item | Per month |
| --- | --- |
| The server (t4g.small) | **$0** until Dec 31, 2026 (AWS free trial), then about $12 |
| Permanent internet address | about $3.65 |
| 20 GB hard drive | about $1.60 |
| Daily backups | under $0.50 |
| **Total** | **about $6** now, about **$18** from January 2027 |

Claude and Deepgram usage is billed separately by those companies. A **$10/month AWS budget alert** emails rohsaw404@gmail.com. It warns you; it does not stop spending.

### How it's set up, in plain terms
- One rented computer runs eight boxes: **Caddy** (secure https address) → **nginx** (password check) → the **website** and the **brain** → the three **tool services** and the **database**.
- The only open doors are the normal web ports. There's no remote login door; maintenance goes through AWS Session Manager.
- API keys and passwords live in AWS's locked safe, never in the code on GitHub.
- The hard drive is encrypted, backed up daily, and **kept even if you delete the deployment**, so no conversations are lost by accident.

### Everyday commands (run from the project folder)

```bash
deploy/aws/deploy.sh status    # Is it up? What's the address?
deploy/aws/deploy.sh update    # Rebuild with the latest code from GitHub (push first)
deploy/aws/deploy.sh logs      # See the server's setup log
deploy/aws/deploy.sh down      # Delete it (the hard drive is kept; see the message it prints)
```

The login for the live site is saved privately in `.secrets/aws-tester-login.txt` on this laptop. It is never put on GitHub.

---

## 7. What's not done yet

- **No real bookings or payments.** Prices for flights, hotels and cars are samples.
- **Day plans can still embellish wording a little** on community listings that have their own description. Places, dates and closures are now enforced in code.
- **The live site doesn't have the newest day-plan fixes yet.** It was built minutes before they were pushed; running `deploy/aws/deploy.sh update` brings it up to date.
- **One shared login.** Everyone uses the same username and password. Real user accounts would be needed for a wider launch.
- **One server.** If it goes down, the site goes down. That's fine for a pilot, not for a business.
- **Backups haven't been test-restored yet.**
- **Speaking replies aloud is off**; it needs an OpenAI or ElevenLabs key.
- **Web sources appear as a plain list of links** at the end of replies; they could be made clickable and tidier.

---

## Glossary

- **AI model:** a program trained to understand and write text. Roam uses three sizes of Claude.
- **API key:** a secret password that lets Roam use a paid service (like Claude or Deepgram).
- **ARM chip:** an energy-efficient type of computer processor, like the one in recent Macs and phones.
- **Container:** a sealed box holding one part of the app with everything it needs, so it runs the same anywhere.
- **Database:** an organized, permanent store of information.
- **Deploy:** to put an app on a computer on the internet so others can use it.
- **Domain name:** a website name like `example.com`. Roam uses a free sslip.io name instead.
- **Gateway:** a program that sits at the front door, checking passwords and directing traffic.
- **HTTPS:** the secure version of a web address (the padlock in your browser).
- **MCP (Model Context Protocol):** a standard way to give an AI a set of tools it's allowed to use.
- **Orchestrator:** the manager AI that splits a request into jobs for specialists.
- **Prototype:** a working demonstration, not a finished product.
- **Specialist (agent):** a smaller AI given one job and a few tools.
- **Web search:** the AI looking things up on the internet, with sources, for current facts.
