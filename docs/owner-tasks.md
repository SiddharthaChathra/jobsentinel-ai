# Owner tasks

These are things only you can do: secrets, keys, dashboard settings, approvals and sign-ups. Each task below has the page, the exact names, how to check it worked, and what breaks if you skip it.

- Never paste a secret value into chat. Secrets go only into the page named in each step.
- Steps marked **(unverified)** are ones I could not check myself, usually because the page needs your login.
- Claude keeps this file current: when you finish a task, say so, and it gets ticked here.

**Your real addresses:**

- Repository: https://github.com/SiddharthaChathra/jobsentinel-ai (public)
- Web app: https://jobsentinel-ai.vercel.app
- API: https://jobsentinel-api-sg.onrender.com
- Supabase project: https://supabase.com/dashboard/project/hktrhvorwsymventjhfu
- Render: the API's service page is under https://dashboard.render.com. I could not determine its exact URL: the service ID is not in the repository, and the Render connection needs a workspace chosen by you.

## Checklist

| #   | Task                                                                           | Status                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Create the backup key and add the two backup secrets, then run the backup once | Done: secrets added 2026-10-18; first run green (artifact `jobsentinel-backup-39154944775`, 16 MB, kept until 2027-01-16). Optional: decrypt it once to prove your key opens it. |
| 2   | Add the Telegram chat id for uptime alerts                                     | Done: `ALERT_TELEGRAM_CHAT_ID` added 2026-10-18; uptime run green (healthy, no alert). A real alert is confirmed only by the next real outage.                                   |
| 3   | Approve the learning links you want shown (33 proposed)                        | **Open**                                                                                                                                                                         |
| 4   | Decide the questions raised by the audit (docs/verification-report.md §4)      | **Open**                                                                                                                                                                         |
| 5   | Look at the new pages on the live site                                         | **Open**                                                                                                                                                                         |
| 6   | Re-check the F4 fresher-score thresholds around 2026-11-18                     | **Open** (not before 2026-11-18)                                                                                                                                                 |
| 7   | The worker dispatch token on Render has Actions read **and write**             | Done: the API starts worker runs with it, which needs write. It also lets the workflow watch re-enable a workflow (D125).                                                        |
| 8   | The production database has every migration (0000–0013)                        | Done (applied 2026-10-18; `/health/worker` answers)                                                                                                                              |
| 9   | The placeholder filter switched on, and the 15 talent-pool postings marked     | Done (2026-10-18)                                                                                                                                                                |

---

## 1. Backup key and secrets (F10, D123)

**What it is:** a weekly encrypted copy of the database, kept as a GitHub artifact for 90 days. Encryption uses your public key; only your private key, kept offline, can open it.

1. **Install `age` on your own computer.** On Windows open PowerShell and run `winget install FiloSottile.age`. Close and reopen PowerShell, then check with `age --version`.
2. **Create the key pair:** run `age-keygen -o jobsentinel-backup.key`. It prints a line `Public key: age1…`. Copy that `age1…` text; it is not secret.
3. **Keep `jobsentinel-backup.key` offline**, for example on a USB drive and in your password manager.
   - Do not put it in the repository or OneDrive, or anywhere online.
   - Lose it, and no backup can ever be opened.
4. **Find the session pooler address:**
   - Open https://supabase.com/dashboard/project/hktrhvorwsymventjhfu, click **Connect** at the top, and choose **Session pooler**.
   - Copy the connection string (`postgresql://postgres.hktrhvorwsymventjhfu:[YOUR-PASSWORD]@…pooler.supabase.com:5432/postgres`) and put your database password into it.
   - It is the same value as `DATABASE_DIRECT_URL` in your local `.env`. **(Unverified: the button's exact label may differ.)**
   - **Port 5432, not 6543.** The transaction pooler (6543) cannot run `pg_dump`.
5. **Add the two secrets:**
   - Open https://github.com/SiddharthaChathra/jobsentinel-ai/settings/secrets/actions and click **New repository secret** twice:
     - Name `BACKUP_AGE_RECIPIENT`, value: the `age1…` public key from step 2.
     - Name `BACKUP_DATABASE_URL`, value: the session pooler string from step 4.
6. **Run it once:** open https://github.com/SiddharthaChathra/jobsentinel-ai/actions/workflows/backup.yml → **Run workflow** → branch `main` → **Run workflow**.

**How to check it worked:**

- The run turns green within about 5 minutes.
- Its page shows an artifact `jobsentinel-backup-<number>`, and the step "Prove the artifact is encrypted and alone" printed one `.sql.gz.age` file.
- Optional: decrypt it once on your machine, following docs/deployment.md "Decrypt a backup", to prove your key opens it.

**If you skip it:** there is no backup at all. A deleted table, a bad migration or a lost Supabase project would lose every job, profile and application. The workflow fails every Sunday, and from day 10 the workflow watch alerts you about it daily.

## 2. Telegram chat id for uptime alerts (F11, D124)

**What it is:** the uptime check runs every 15 minutes from 07:30 to 00:15 IST. When the API or worker goes down, it messages you, and again when it recovers. It needs to know your chat.

1. **Find your chat id.** You have already linked Telegram to JobSentinel, so the id is stored:
   - Open https://supabase.com/dashboard/project/hktrhvorwsymventjhfu/sql/new.
   - Run `select chat_id from telegram_links where linked_at is not null;`
   - Copy the number (it may be negative). **(Unverified: the SQL editor path.)**
2. Open https://github.com/SiddharthaChathra/jobsentinel-ai/settings/secrets/actions → **New repository secret**. Name: `ALERT_TELEGRAM_CHAT_ID`; value: the number. `TELEGRAM_BOT_TOKEN` is already there; don't change it.
3. Open https://github.com/SiddharthaChathra/jobsentinel-ai/actions/workflows/uptime.yml → **Run workflow**.

**How to check it worked:**

- The run is green, and its log says `healthy (previous: healthy) — API: ok · Worker: ok` and `no change: no alert`.
- No message is sent while things are healthy; that's by design.
- To see a real alert, wait for a real outage. Don't fake one in production.
- **(Unverified until an outage: that a real alert arrives.)**

**If you skip it:** the check still runs and shows red in GitHub during an outage, but nothing tells you. You would find out only by opening the site.

## 3. Approve learning links (F7, D120)

**What it is:** the skill-gap page can link each missing skill to free, official learning material. Nothing is linked until you approve it. Every URL below loaded (HTTP 200, same site) on 2026-10-18 (`pnpm links:check`).

1. Read the list below and decide which entries you want.
2. Open https://github.com/SiddharthaChathra/jobsentinel-ai/edit/main/packages/config/src/taxonomy/learning-links.json, which is GitHub's web editor.
3. For each skill you approve, change `"approved": false` to `"approved": true`. Don't change the URLs. To drop a link, tell Claude and it will remove it.
4. **Commit changes** directly to `main`, or tell Claude which skills to approve and it will do it.

**How to check it worked:**

- After the next deploy (Render redeploys the API on each commit), open https://jobsentinel-ai.vercel.app/skill-gaps. An approved skill in your top gaps shows "Recommended learning" with its link.
- CI's unit tests re-check the file's format on the commit.

**If you skip it:** the skill-gap page still works. It just shows no links.

### The 33 proposed links, by skill

- **Go** (approved: false)
  - A Tour of Go (go.dev): https://go.dev/tour/
  - Go documentation (go.dev): https://go.dev/doc/
- **Kubernetes** (approved: false)
  - Learn Kubernetes Basics (kubernetes.io): https://kubernetes.io/docs/tutorials/kubernetes-basics/
- **Google Cloud** (approved: false)
  - Get started with Google Cloud (cloud.google.com): https://docs.cloud.google.com/docs/get-started
- **Terraform** (approved: false)
  - Terraform tutorials (HashiCorp): https://developer.hashicorp.com/terraform/tutorials
- **Ruby** (approved: false)
  - Ruby in Twenty Minutes (ruby-lang.org): https://www.ruby-lang.org/en/documentation/quickstart/
- **Rust** (approved: false)
  - The Rust Programming Language (the book) (rust-lang.org): https://doc.rust-lang.org/book/
- **C++** (approved: false)
  - Get Started! (Standard C++ Foundation): https://isocpp.org/get-started
- **Kafka** (approved: false)
  - Apache Kafka quickstart (Apache Software Foundation): https://kafka.apache.org/quickstart
- **C#** (approved: false)
  - A tour of the C# language (Microsoft Learn): https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/
- **GraphQL** (approved: false)
  - Learn GraphQL (graphql.org): https://graphql.org/learn/
- **Elasticsearch** (approved: false)
  - Get started with Elasticsearch search (Elastic): https://www.elastic.co/docs/solutions/search/get-started
- **Spring Boot** (approved: false)
  - Building an Application with Spring Boot (spring.io): https://spring.io/guides/gs/spring-boot/
- **Ansible** (approved: false)
  - Getting started with Ansible (Ansible (Red Hat)): https://docs.ansible.com/projects/ansible/latest/getting_started/index.html
- **Redis** (approved: false)
  - Get started with Redis (redis.io): https://redis.io/docs/latest/get-started/
- **Vue** (approved: false)
  - Vue tutorial (vuejs.org): https://vuejs.org/tutorial/
- **Apache Spark** (approved: false)
  - Spark quick start (Apache Software Foundation): https://spark.apache.org/docs/latest/quick-start.html
- **SQL** (approved: false)
  - PostgreSQL tutorial: the SQL language (PostgreSQL Global Development Group): https://www.postgresql.org/docs/current/tutorial-sql.html
- **PostgreSQL** (approved: false)
  - PostgreSQL tutorial (PostgreSQL Global Development Group): https://www.postgresql.org/docs/current/tutorial.html
- **Python** (approved: false)
  - The Python Tutorial (python.org): https://docs.python.org/3/tutorial/
- **Java** (approved: false)
  - Learn Java (dev.java (Oracle)): https://dev.java/learn/
- **JavaScript** (approved: false)
  - JavaScript Guide (MDN Web Docs): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide
- **TypeScript** (approved: false)
  - The TypeScript Handbook (typescriptlang.org): https://www.typescriptlang.org/docs/handbook/intro.html
- **React** (approved: false)
  - Learn React (react.dev): https://react.dev/learn
- **Node.js** (approved: false)
  - Introduction to Node.js (nodejs.org): https://nodejs.org/learn/getting-started/introduction-to-nodejs
- **Next.js** (approved: false)
  - Learn Next.js (nextjs.org): https://nextjs.org/learn
- **Angular** (approved: false)
  - Angular tutorials (angular.dev): https://angular.dev/tutorials
- **Django** (approved: false)
  - Writing your first Django app (djangoproject.com): https://docs.djangoproject.com/en/stable/intro/tutorial01/
- **Flask** (approved: false)
  - Flask tutorial (Pallets): https://flask.palletsprojects.com/en/stable/tutorial/
- **Docker** (approved: false)
  - Docker: get started (Docker): https://docs.docker.com/get-started/
- **AWS** (approved: false)
  - Getting started with AWS (Amazon Web Services): https://aws.amazon.com/getting-started/
- **Azure** (approved: false)
  - Azure training (Microsoft Learn): https://learn.microsoft.com/en-us/training/azure/
- **Git** (approved: false)
  - Pro Git (book) (git-scm.com): https://git-scm.com/book/en/v2
- **Linux** (approved: false)
  - The Linux command line for beginners (Canonical (Ubuntu)): https://ubuntu.com/tutorials/command-line-for-beginners

**Soft skills** (Communication, Teamwork, Leadership, Problem Solving, Agile) never get links. They appear only in the separate "soft skills" note, as you asked.

## 4. Decide the audit's open questions

Read docs/verification-report.md §4 and answer each question in chat. No page or secret is needed.

1. **Defect 3:** should new users see TRAINEE jobs by default? Recommended: FULL_TIME + TRAINEE.
2. **Defect 2:** should Telegram use exactly the dashboard's eligibility rule? Recommended: yes.
3. **Defect 7:** should the badge need more than 5 postings?
4. **Defect 8:** what to do about the 162 jobs held in Needs review.
5. **Commit the local port change (553xx)?** Recommended: yes.

**If you skip it:** the HIGH defect (1) is fixed either way. These choices decide how defects 2, 3, 7 and 8 are fixed.

## 5. Look at the new pages on the live site

Automated tests and local screenshots cover these, but nobody has looked at them in production.

1. Sign in at https://jobsentinel-ai.vercel.app/login.
2. Check each page:
   - **https://jobsentinel-ai.vercel.app/applications:** a "Reminders" section appears if any reminder is due or upcoming. There are date pickers under each tracked job.
   - **https://jobsentinel-ai.vercel.app/skill-gaps:** ranked gaps like "SQL — missing in N of M".
   - **https://jobsentinel-ai.vercel.app/settings:** the toggles "Reminders", "Follow up after N days" and "Weekly summary on Sunday 09:00".
   - **https://jobsentinel-ai.vercel.app/jobs:** a "Hires freshers often" badge on Groww, Zeta, FamPay, HackerRank Careers and the other badged companies. They need a listed job for it to show.
   - **Needs review tab on /jobs:** held jobs, each with its reason.
3. Tell Claude what looks wrong. A screenshot helps.

**How to check it worked:** each page loads without an error banner.

**If you skip it:** a layout or wiring problem that only shows with real data (or on Vercel) stays unnoticed.

## 6. Re-check the fresher-score thresholds (around 2026-11-18)

Ask Claude to "re-check the F4 thresholds". It will show the badged companies and boards again with a month more data. Nothing to do before then.

---

### Local machine note (not a task)

Windows reserves blocks of TCP ports above 49152 that move between reboots, so the local Supabase test stack uses 44320–44329 (`supabase/config.toml`); `TEST_STACK_PORT_BASE` moves it. If tests ever fail with "ports are not available", run `netsh interface ipv4 show excludedportrange protocol=tcp` in PowerShell and tell Claude the ranges.
