# Oral English page (`/oral-english`)

The interactive page that the TECHMED Oral English Guide sends students to. It has three tabs:
- **Listen:** the book's five parts, where students tap any word to hear it.
- **Word Bank:** about 1,500 searchable words, including every word used in the past questions.
- **Challenge:** five timed quizzes, each 20 random questions in 10 minutes, with explanations after submitting.

It is for book owners only. The page lives on the website, not KAIRO, because KAIRO is free and independent, while the book is sold here.

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
- It was created **inactive**, with a placeholder price of ₦2,000 and `metadata.price_confirmed = false`.
- To put it on sale, set the real price and then activate it:
  ```sql
  UPDATE public.products SET price_ngn = <price>, is_active = true,
         metadata = metadata || '{"price_confirmed": true}', updated_at = now()
  WHERE id = 'oral-english-guide';
  ```
- Buying it writes an entitlement through the normal payment flow. That one entitlement unlocks Listen, the Word Bank and all five challenges.
- Admins can open the page at any time to test it.
- It is not yet included in any plan. To include it, add it to the plans' `bundle_item_ids`, as the Physics books were.
- The locked page's "Get the book" button points to `/resources` until the book has its own resource page. Change `BUY_URL` in the page when it does.

## Links for the book

- Main page: `https://techmedng.com/oral-english`
- Each part's challenge box: `https://techmedng.com/oral-english#challenge-1` to `#challenge-5`. These open the Challenge tab at that part.
- Listen for a part: `#part-1` to `#part-5`.

## Audio

Until clips exist, the page uses the phone's own voice and tells students so. To record the British English clips:

1. As an admin, export the texts with `select public.oral_audio_texts();` and save the JSON outside the repo. That JSON contains book content.
2. Run the generator:
   ```
   cd web
   GOOGLE_TTS_API_KEY=... node scripts/generate-oral-audio.mjs --texts /path/oral-audio-texts.json --review /path/review.html
   ```
   - It produces about 1,760 clips and about 46,000 characters of SSML, which fits in Google's free monthly allowance.
   - Files that already exist are skipped, so re-running only fills gaps.
   - The default voice is `en-GB-Neural2-A`. Use `--voice` to change it.
3. Spot-check the clips with the review page, especially the ones the brief lists: plait, heir, colonel, buoy, coup, indict, clerk, says, said, the tear/wind/wound pairs, bath/bathe, chalet, champagne, Thames, Thomas, of, gnash, psychology, every noun–verb pair, and all 70 emphatic sentences.
4. Commit `web/public/audio/oral/` and deploy.

How the generator reads each kind of item:
- **Noun–verb pairs** (EXport/exPORT) **and meaning-dependent words** (tear, wind, wound, bow, row, lead, read, live, close, minute, use, dove): the voice is given British IPA.
- **Emphatic sentences:** the capitalised word gets `<emphasis level="strong">`.
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
