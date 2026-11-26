# Oral English page (`/oral-english`)

The interactive page that the TECHMED Oral English Guide sends students to. It has three tabs:
- **Listen:** the book's five parts, where students tap any word to hear it.
- **Word Bank:** about 1,500 searchable words, including every word used in the past questions.
- **Challenge:** five timed quizzes, each 20 random questions in 10 minutes, with explanations after submitting.

The full app is for book owners only. The page lives on the website, not KAIRO, because KAIRO is free and independent, while the book is sold here.

## Public landing page and search

Everyone else sees a landing page, written into the HTML so search engines and AI tools can read it. It has:
- the title "JAMB Oral English, with audio"
- a **free preview**: 12 words to hear (ship/sheep, colonel, plait, heir, buoy, EXport/exPORT, silent letters)
- a **free 6-question taster**: one real JAMB question from each part, with explanations, defined in the page's front matter (public on purpose)
- what's inside, the price, and 6 FAQs

Search and sharing:
- Title and meta description target "JAMB oral English" and "UTME".
- JSON-LD covers the Product (₦1,000, InStock, linking to the resource page) and an FAQPage.
- The share image is `web/public/images/og/oral-english.png`, shown on WhatsApp, Facebook and X.
- `web/public/llms.txt` describes the page for AI assistants.
- The page is in the sitemap.

## Where things are

| Thing | Where |
|---|---|
| Page | `web/src/pages/oral-english.astro` |
| Audio file names (shared by page and generator) | `web/src/lib/oralAudioKey.js` |
| Audio generator | `web/scripts/generate-oral-audio.mjs` |
| Clips | `web/public/audio/oral/<key>.mp3` and `manifest.json` |
| Schema and functions | `supabase/migrations/20261125000001_oral_english_page.sql` |
| Content (book lists, 421 questions, Word Bank) | **Database only**: `public.oral_content`, `oral_questions`, `oral_words` |

**The content is not in this repository, on purpose.** The repository is public and the question bank includes answers. The page loads everything after sign-in through `oral_page()`, `oral_start()` and `oral_submit()`. Each of these checks `has_resource_access('oral-english-guide')`, and admins always pass. Answers and explanations leave the server only after a student submits. RLS is on and there are no read policies.

## Access

- Product id: `oral-english-guide`, a `resource`.
- Price: **₦1,000** (Core members get the usual plan discount at checkout).
- **Included in Mastery and Ultimate** (every variant). Current plan holders were given access when it was added.
- **On sale since 26 Nov 2026.** The ebook is `paid-resources/oral-english-guide.pdf` (224 pages, A5, 2.2 MB), set as `products.metadata.file_path`. It is read online in the TECHMED Library.
  - The PDF was made from the final .docx with LibreOffice, with the book's fonts (Montserrat, Source Sans 3) installed, so they are embedded.
  - All 11 links in it are clickable.
- It is listed on `/resources` as `/resources/oral-english-guide`, under the new "English" subject filter, with the entry in `web/src/lib/resources.ts`.
- Every "Get the guide" button on `/oral-english` points to that resource page (`BUY_URL`).
- Buying it writes an entitlement through the normal payment flow. That one entitlement unlocks the ebook, Listen, the Word Bank and all five challenges.
- Admins can open the page at any time to test it.

## Links for the book

- Main page: `https://techmedng.com/oral-english`
- Each part's challenge box: `https://techmedng.com/oral-english#challenge-1` to `#challenge-5`. These open the Challenge tab at that part.
- Listen for a part: `#part-1` to `#part-5`.

## Audio

The clips are recorded with **Kokoro**, a free, open-source British English voice (`bf_emma`). It needs no account, no API key and no payment. Google Text-to-Speech is also supported, but it needs a billing account. If a clip is missing, the page uses the phone's own voice for that item.

To record or re-record clips:

1. As an admin, export the texts with `select public.oral_audio_texts();` and save the JSON outside the repo. That JSON contains book content.
2. Build the plan. This lists only clips that do not exist yet:
   ```
   cd web
   node scripts/generate-oral-audio.mjs --texts /path/oral-audio-texts.json --plan /path/plan.json
   ```
3. Record the clips. This needs Python 3.10 to 3.12 with `pip install "kokoro>=0.9.4" soundfile` (CPU torch is fine) and ffmpeg:
   ```
   python scripts/kokoro_render.py --plan /path/plan.json --verify --report /path/unverified.json
   ```
   `--verify` needs `pip install faster-whisper librosa`, and you should always use it.
   - Single words are recorded in several ways until a speech recogniser (Whisper `small.en`) hears the right phonemes and nothing sounds after the word. For example, heir heard as "air" passes, while plait heard as "plaid" fails.
   - Words with no passing take keep the closest take and are listed in the report.
   - Words are recorded in rounds. Each round records the next take of every word not yet verified, and Whisper hears about 15 takes at once in one 30-second window. All 1,756 clips take about 25 minutes on a 4-core CPU. Use `--limit 20` for a quick trial.
4. Spot-check the clips, especially the ones the brief lists: plait, heir, colonel, buoy, coup, indict, clerk, says, said, the tear/wind/wound pairs, bath/bathe, chalet, champagne, Thames, Thomas, of, gnash, psychology, every noun–verb pair, and all 70 emphatic sentences.
5. Commit `web/public/audio/oral/` and deploy.

To use Google instead, run `GOOGLE_TTS_API_KEY=... node scripts/generate-oral-audio.mjs --texts ... --engine google`.

How each kind of item is read. These rules live in `describe()` and are shared by both engines:
- **Noun–verb pairs** (EXport/exPORT) **and meaning-dependent words** (tear, wind, wound, bow, row, lead, read, live, close, minute, use, dove): the voice is given the exact British IPA.
- **Emphatic sentences:** read naturally in the same voice. The capitalised word gets Kokoro's own stress marker (`[word](+2)`), which makes a small, natural difference. Nothing is changed after recording. An earlier version made the word louder, longer and higher afterwards, and the founder rejected it because it sounded like a second voice cutting in.
- **Clean starts:** clips are recorded at normal speed (1.0) and cut to begin 30 ms before Kokoro's own word start, with a short fade-in. At a slower speed (0.9), Kokoro made a stray sound before some words (heir, coup, indict, of, exPORT) that students could mistake for part of the word.
- **Clean ends:** every clip is cut to exactly the span Kokoro reports for the word, from 30 ms before its start to 50 ms after its end. Anything Kokoro produces after the word (the "extra sounds at the end" the founder heard, for example after "sheep") is dropped.
  - Do not trim by loudness. A short silence inside a word is the closure of a stop consonant, and the sound after it is the last syllable ("psycholo-gy", "Wednes-day", "thirst-y", "ques-tion", "mar-ch").
  - An earlier version did trim by loudness, and it cut those syllables off. `trim_tail()` is kept in the script only as a warning and is not used.
- **Sound-alikes:** a few words that Kokoro garbles on their own are recorded from a spelling with exactly the same British pronunciation: heir as "air", and tear (to rip) as "tare". See `SAY_AS`.
- **Carrier phrases:** if a word on its own fails, it is recorded as the last word of a short phrase, such as "Next. heir." or "The word is heir.", and only the word is kept.
- **Wrong stress patterns:** never recorded or playable.

Students can tap **"Sounds wrong?"** in the Word Bank. Reports go to `public.oral_reports`, which only admins can read. To fix a clip, delete its MP3 and re-run the generator.

## Updating content

- The data was loaded from the brief's JSON file, which is kept outside the repository.
- The load was adjusted in these ways:
  - The /h/ card's `"who; silent: hour"` was split. The card now has words `high, who` and a separate silent-h line: `hour, honest, heir, ghost`.
  - Plain ambiguous words (tear, wind, wound, live, refuse) were left out of the Word Bank in favour of their labelled forms.
  - Stress patterns taken from answers (CAL-cu-la-tor, CereMOniously) were tidied to the form `CALculator`.
  - 400 extra words that students commonly mispronounce were added (`origin = 'extra'`).
- To change content, upsert into the three tables. Upserts on `oral_questions` use `(part, position)` as the key.

## Tests

The behaviour tests run on a local Postgres with a Supabase stub. They cover:
- access for anonymous users, non-owners, owners and admins
- 20 questions with no answers before submit
- resuming an attempt
- scoring, including garbage answers
- double submit
- cross-user access
- stats
- "none of the above" staying last
- that only granted functions can be called

A Playwright run of the built page checked it with all database calls answered by that local copy:
- the signed-out, locked and owner states
- every Listen part
- Word Bank search and the any-word fallback
- reload during a challenge
- marking
- no playable wrong stress patterns
- no horizontal scroll at phone width
