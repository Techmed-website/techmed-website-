# TECHMED × KAIRO handover (25 Nov 2026)

Read this first. It is the state of the work at the end of the session that built KAIRO's own daily quiz system, and the brief for what comes next.

## 1. Where things live

| Thing | Where |
|---|---|
| Website `techmedng.com` | repo `Techmed-website/techmed-website-`, Astro 5 in `web/`, Cloudflare Worker `techmed-website`. Deploys on push to `main` (Cloudflare Workers Builds). Workflow `sanity-rebuild.yml` (run by hand) forces a rebuild. |
| KAIRO `kairo.techmedng.com` | repo `Techmed-website/KAIRO`, React 18 + Vite PWA in `apps/kairo`. **Live branch is `ccr-03fba2de-mk3oq7`, not `main`. Never move or rebase it.** Workers project `kairo-staging` deploys from it. |
| Database | Supabase project `unbgborbhxzsotaieiun`, schema `cbt` = single source of truth for questions, quizzes, attempts. Website data lives in `public`. |
| CMS | Sanity project `kxoz58eb`, dataset `production` (blog, resources, old quiz listings). |
| Push | OneSignal app "Techmed app" `25f06ed1-29ab-4da8-871a-2fb9f0aa35b5` (website), app "Kairo" `5983fe20-b980-4991-ab88-9bb3a1994bd2` (KAIRO). |

Work on a branch, open a PR, merge into `main` (website) or `ccr-03fba2de-mk3oq7` (KAIRO). The founder checks everything live on the phone.

## 2. Rules that still apply

- Change only `cbt`, the two repos, and the website's own `public` tables when a feature needs them. Never touch old Kairo schemas or other projects.
- No destructive SQL (DROP / DELETE / TRUNCATE / bulk UPDATE of questions) without showing it and getting approval. Use migrations in `supabase/migrations`. Tip: the Supabase MCP shows a confirmation prompt for those words, and it times out on the founder's phone. Write migrations that avoid them: `create or replace`, wrappers, nulling a column instead of deleting rows.
- RLS on everywhere. Answer keys and explanations never reach the browser before submit. Scoring happens on the server.
- Labels: "JAMB Past Question, {year}" only when the year is verified, otherwise "Practice Question". TECHMED-written questions are "TECHMED Practice Question".
- KAIRO is free: no activation code, no PIN. That is the selling point. KAIRO should feel independent and practice-first. Enrolment nudges stay gentle and optional.
- Local SQL test harness: `KAIRO/supabase/drafts/tests/run.sh` (Postgres 16; start it with `pg_ctlcluster 16 main start`). 15 suites, all pass. Add a suite for every new migration. App tests: `cd apps/kairo && npm test` (26 pass).

## 3. What is built and live

**Daily quiz engine (replaces QuizBoot)**
- `cbt.build_daily_quiz()` runs at 04:30 Lagos (pg_cron `techmed-daily-quiz-build`); a watchdog runs at 05:00. Each quiz is 10 questions in 5 minutes, ranked, open to guests.
- Subjects rotate Biology → Chemistry → Physics → English, one topic per day, in JAMB syllabus order (`cbt.topic_order`, `cbt.daily_topic_log`). No Maths and no mixed quizzes, by the founder's decision.
- Questions must be published, with a key and an explanation, and have no open review or report. The 566 `ai_legacy` keys are included on purpose.
- The caption for WhatsApp is stored in `assessments.caption`.
- 13,779 published questions as of today.

**KAIRO app**
- `/q/:id` is the shareable instructions screen: guest play, passcode, resume.
- The CBT runner autosaves to the server. The result screen gives encouragement by pass/neutral/fail band, then a subtle TECHMED classes/resources card, push opt-in, "save your score" for guests, rank, and a 1080×1080 share card.
- **Quizzes tab** (`/quizzes`): today's quiz, challenges, recent quizzes. `/quiz/:id` shows details, your result and the full leaderboard.
- Staff quiz admin at `/editor/quizzes`: create/edit challenges, passcodes, results, reject attempts. Staff = `cbt.is_staff()`.
- Login is shared with the website (cookie on `.techmedng.com`). Guests use anonymous sign-in, converted later with `updateUser`.

**Push**
- KAIRO (`kairo-push` Edge Function, `cbt.kairo_push_plan`):
  - 06:00 "☀️ Morning Charge" (a quote from `cbt.daily_quotes` plus today's quiz) to everyone.
  - 19:30 practice reminder, only to students who have not practised today.
  - 13:00 every second day until 14 Dec, an optional classes note, only to students without a cohort plan.
- Website (`notify-push` Edge Function v9): 06:00 "🔥 Day N quiz is live" links to `techmedng.com/quizzes/<slug>`. Sanity quizzes with programme "Daily Builder" are no longer announced.
- Each kind of notification replaces its previous one (`web_push_topic`).

**Website**
- `/quizzes/<slug>` renders KAIRO quizzes on request (`web/src/lib/kairoQuizzes.ts`) with OG images in `web/public/images/quiz-og/`, falling back to Sanity.
- A "Today on KAIRO" strip appears on `/quizzes`.

**QuizBoot is switched off.** The Claude scheduled task "TECHMED Daily Builder Quiz" (`trig_0197wMBNXYjmQUUtVac1UTdu`) was disabled on 25 Nov, not deleted. The founder cancels the QuizBoot subscription. The last QuizBoot quiz (Day 15) is still listed in Sanity as `featured: true`; see task A2.

## 4. Next session: tasks in priority order

### A. Website must reflect today's reality (do first)

1. Sweep **every page** of `techmedng.com` for out-of-date claims. Known examples:
   - `web/src/components/QuizHub.astro` still says KAIRO is "coming soon".
   - `resources.astro` lists "free quiz practice" separately from KAIRO.
   - `ComingSoon.astro` is used for KAIRO in places.
   - QuizBoot is mentioned in `QuizHub.astro`, `ResourceDetail.astro`, `lib/resources.ts`, `quizzes/[slug].astro`.

   Grep for `coming soon`, `quizboot`, `QuizBoot`, `Kairo`, `CBT`. The message everywhere: **KAIRO is live and free. Free JAMB CBT practice, 13,000+ past questions, every subject, no activation code or PIN, a daily quiz with a leaderboard.** Link to https://kairo.techmedng.com.
2. Retire the QuizBoot listings:
   - Unfeature the Sanity "Daily Builder" quiz docs. Use `featured:false` only; do not delete them, because old links must keep working.
   - Make `/quizzes` lead with KAIRO's daily quiz and challenges.
3. Study planner:
   - Move `web/src/pages/tools/study-planner.astro` into the **dashboard** (`dashboard.astro`) and into **KAIRO's home**.
   - Dissolve the Tools section **permanently**: remove `tools.astro` and the nav links, and add redirects from `/tools` and `/tools/study-planner` to the dashboard.
   - If students' planner data should follow them, store it in the DB, not localStorage.

### B. Make KAIRO better (launch quality)

1. **Home page**: the founder finds it too basic. Ideas from competitor screens (MySchool, TestDriller) are in section 5.
2. **Streaks and badges**: a daily streak counted from attempts in Lagos days, plus badges for first quiz, a 7-day streak, a 100% score, topic mastery and so on. Store them in `cbt` and show them on Home, Profile and the result screen. The evening reminder can say "keep your N-day streak".
3. **Performance analysis**, free for now (it may be gated later):
   - Make both the per-result analysis and the overall analysis much richer: by subject and topic, trend over time, strongest and weakest topics, speed (time per question), accuracy versus the average, and a "practise this topic next" action.
   - Look at existing `features/performance` and `cbt.topic_stats`.
4. Vet the rest of KAIRO for any broken or half-done flow, especially on a phone.

### C. TECHMED dashboard "Insights"
- Show each student's KAIRO progress (quizzes, scores, streak, topic strengths) inside the website dashboard's insight section. Shared login means the same user id. Read through SECURITY DEFINER RPCs in `cbt` that return only the caller's data.
- **Attendance** for paid-class students (cohort entitlements in `public.entitlements`, `resource_id like 'cohort-%'`):
  - Design the tables: sessions, attendance marks (taken by tutors), and maybe self check-in with a code.
  - Show attendance in the student's Insights next to quizzes.

### D. Staff and founder accounts
- **Staff** (tutors and community manager): an admin area to follow students: progress, attendance, quiz results, who is falling behind. Use role-based access with a roles table and RLS. Reuse or extend `cbt.is_staff()`.
- **Founder**: a separate, founder-only metrics section covering:
  - KAIRO: daily active users, attempts, quiz players, push opt-ins, guest-to-account conversion.
  - Website: signups, enrolments, revenue, resource sales, traffic if available.
  - Classes: attendance, cohort size.

  Before building it, confirm the role names and who gets what.

### E. Operation 100 (decision pending from the founder)
- Last year: 100 freshly picked questions every day, and it worked very well.
- Options are to reuse this year's QuizBoot set, or have KAIRO pick 100 fresh questions daily from the bank. KAIRO already has the picking machinery (`_daily_eligible` / `_daily_pick`).
- Recommendation to bring to the founder: run it on KAIRO, with 100 questions daily picked fresh, a JAMB-style timer, its own leaderboard and a streak. Ask before building.

### Deferred
- Comments on quizzes (not needed now).
- The Google consent screen shows the Supabase project id. Fixing it needs Google brand verification or a paid Supabase custom domain.

## 5. Lessons from MySchool and TestDriller (founder's screenshots)
- **Onboarding:**
  - A 4-slide carousel with one benefit per slide ("Study and practice for any CBT", "Ask questions, join study groups", "Premium resources", "News and events"), then Login / Create Account / **Continue as a Guest**.
  - KAIRO already allows guest play. Make it this obvious on the welcome screen.
- **Home:**
  - A big hero card at the top. Theirs is a paid "Activate" card; ours should be today's quiz and streak, or the optional classes banner.
  - Then large, colourful quick-link tiles: Study past questions, Topic videos, Novels, Store.
  - Then **Upcoming events** (dated cards such as "27 Nov: UEE resumption") and **News** with comment counts.
  - KAIRO could show JAMB dates and TECHMED class dates as events.
- **Study hub:** a tile grid with Study past questions, Past-question videos, Topic video lessons, Novels (summary plus past questions per JAMB novel, e.g. *The Lekki Headmaster*), JAMB Brochure, JAMB Syllabus, WAEC Syllabus, Lesson notes. TECHMED already has a JAMB syllabus on the website, so link or embed it.
- **Test:** separate simulators for JAMB, WAEC, NECO, a custom CBT and a Challenge, plus a **leaderboard with tabs** (Challenge, JAMB, WAEC, ...) that shows the aggregate JAMB score (out of 400), points, best score, time advantage and subjects.
- **Offline:** per-subject "download questions" with counts (Maths 4,475, English 9,198, Chemistry 4,368, Physics 4,834) and "download question images". KAIRO is a PWA and could offer a per-subject offline pack.
- **Dashboard:** weekly points, challenges taken, total average performance, tests taken, exam history, performance analysis, saved questions, saved videos.
- **TestDriller:**
  - "Practice for UTME, with exactly 36,363 questions offline": an exact count builds trust, so show KAIRO's live count.
  - Also: Classroom (materials plus an AI tutor), Science notes, **Question search**, result history, performance analysis, and a winners banner with a prize cheque (social proof).
- **Both** put a payment gate up front (₦4,000 device activation). KAIRO's answer is that everything is free, which should be said loudly everywhere.
