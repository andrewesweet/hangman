# Word list

`words.json` is the only source of categories, answers, hints and difficulty for every hangman page in this repository. Pages never hold their own lists: `tools/inline-words.py` copies this file into each page.

## Schema

```json
{"version": 1, "categories": [
  {"id": "animals", "name": "Animals", "words": [
    {"answer": "GUINEA PIG", "hint": "Small sociable rodent that wheeks for its supper", "difficulty": "easy"}
  ]}
]}
```

- `id` is one of `animals`, `mythology`, `plants`, `gemstones`, `birds`, `food-and-drink`, `geography`, `uk-number-ones`.
- `answer` is upper case, in British spelling. Spaces separate the words of a phrase. Digits and punctuation are shown to the player already filled in, so only A-Z are guessed. Outside `uk-number-ones`, an answer has 3-14 letters in total, which matches the word-length range the games offer.
- `hint` is one line and never contains the answer or an obvious stem of it. In `uk-number-ones` the answer is the single's title and the hint is exactly `Artist, YEAR`.
- `difficulty` is `easy`, `medium` or `hard`.

## The music list

`uk-number-ones` holds every UK number-one single from 1990 to 2009 as listed by the Official Charts Company ([All the Number 1 singles](https://www.officialcharts.com/chart-news/all-the-number-1-singles__7931/)), with titles as that list prints them. Artist names are in their usual form, so the list's "VERVE" becomes "The Verve" and its "FEDDE LE GRANDE" becomes "Fedde le Grand". Accents are dropped because answers are ASCII. Each title appears once; when a title reached number one more than once in that period, the hint gives the artist and year of the first time. Five titles are left out under the family-friendly rule: "Because I Got High", "Chocolate Salty Balls", "F**k It (I Don't Want You Back)", "F.U.R.B. (F U Right Back)" and "I Wanna Sex You Up". Difficulty follows the total weeks spent at number one: 3 or more weeks is easy, 2 weeks is medium and 1 week is hard.

## Adding a word

Add an object to the right category's `words` array, then run the check:

```sh
python3 tools/inline-words.py --check
```

The check prints each problem and exits non-zero if the file breaks the schema, uses an unknown id or difficulty, puts a character other than A-Z, a digit, punctuation or a single space in an answer, repeats an answer within a category, lets a hint give away its answer, or drops a category below its minimum count. The minimum is 180 words for each category and 400 for `uk-number-ones`.

## Putting the words into a page

A page holds the data in exactly one block:

```html
<!-- words:begin --><script id="hangman-words" type="application/json">...</script><!-- words:end -->
```

and reads it only with `JSON.parse(document.getElementById('hangman-words').textContent)`. The game, `play.html`, gets its block from `python3 tools/build.py`, which reuses the inliner's validation (see the [README](../README.md#building)). To refresh any other page after editing `words.json`, run:

```sh
python3 tools/inline-words.py path/to/page.html
```

The inliner validates `words.json` first. It refuses every page if any page has no marker pair or more than one, and in that case it writes nothing. `python3 tools/inline-words.py --selftest` runs its own tests.
