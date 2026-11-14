import assert from "node:assert/strict";
import { test } from "node:test";
import { libraryCatalog, libraryLanguage, libraryQuestion, librarySubjects, questionBank } from "../src/question-bank.js";
import { validateGeneratedQuiz } from "../src/quiz.js";

test("the bilingual library covers its promised sampler and supplies goals, clues and valid answer keys", () => {
  assert.equal(questionBank.length, 138);
  assert.equal(new Set(questionBank.map(question => question.id)).size, 138);
  for (const subject of librarySubjects) {
    const questions = questionBank.filter(question => question.subject === subject);
    assert.equal(questions.length, subject === "Maths" ? 48 : 6, subject);
  }
  for (const language of ["en", "nb"] as const) {
    const catalog = libraryCatalog(language);
    assert.equal(catalog.length, 138);
    assert.equal(new Set(catalog.map(question => question.question)).size, 138);
    assert.ok(new Set(catalog.slice(0, 12).map(question => question.subject)).size > 8);
    for (const entry of catalog) {
      assert.deepEqual(Object.keys(entry).sort(), ["goal", "id", "level", "question", "subject"]);
      assert.ok(entry.goal.length > 0 && entry.goal.length <= 160);
      const selected = libraryQuestion(entry.id, language);
      assert.ok(selected.hint.length > 0 && selected.hint.length <= 320);
      assert.ok(selected.generated.explanation.length > selected.generated.options[selected.generated.correctIndex]!.length);
      assert.deepEqual(validateGeneratedQuiz(selected.generated), selected.generated);
      assert.equal(selected.generated.question, entry.question);
    }
  }
  for (const question of questionBank) {
    assert.equal(libraryQuestion(question.id, "en").generated.correctIndex, libraryQuestion(question.id, "nb").generated.correctIndex);
  }
  assert.throws(() => libraryLanguage("fr"));
  assert.throws(() => libraryQuestion("../private", "en"));
  assert.throws(() => libraryQuestion("unknown-question", "en"));
});

test("maths visual answer keys agree with the actual rows, fractions and distances, without equivalent distractors", () => {
  const visual = questionBank.filter(question => question.subject === "Maths" && question.visual);
  assert.equal(visual.length, 20);
  for (const item of visual) {
    for (const language of ["en", "nb"] as const) {
      const { generated } = libraryQuestion(item.id, language);
      const answer = generated.options[generated.correctIndex];
      const scene = generated.visual!;
      if (scene.kind === "array") assert.equal(Number(answer), scene.rows * scene.columns, item.id);
      else if (scene.kind === "numberLine") assert.equal(Number(answer), scene.to - scene.from, item.id);
      else if (scene.kind === "fraction") {
        assert.equal(answer, `${scene.filled}/${scene.parts}`, item.id);
        assert.equal(generated.options.filter(option => {
          const [numerator, denominator] = option.split("/").map(Number);
          return numerator! / denominator! === scene.filled / scene.parts;
        }).length, 1, item.id);
      }
    }
  }
});

test("transfer questions distinguish units, estimates, time crossing and multi-step reasoning", () => {
  const answers = {
    "maths-books": "25", "maths-balloons": "23", "maths-lunch-boxes": "24", "maths-share-buttons": "4",
    "maths-place-seven": "70", "maths-build-number": "508", "maths-pattern-five": "25", "maths-pattern-double": "48",
    "maths-metres": "200", "maths-grams": "500", "maths-millilitres": "750 mL", "maths-clock-half": "14:30",
    "maths-clock-cross-hour": "17:15", "maths-square-perimeter": "20 cm", "maths-rectangle-area": "12 cm²",
    "maths-triangle-corners": "3", "maths-cube-faces": "6", "maths-decimal-compare": "0.7", "maths-decimal-add": "0.7",
    "maths-half-of-eighteen": "9", "maths-quarter-of-twenty": "5", "maths-fraction-same-whole": "Half a ribbon",
    "maths-equivalent-fraction": "2/4", "maths-shop-change": "16 kr", "maths-two-step-trip": "15",
    "maths-divide-remainder": "2", "maths-estimate": "60", "maths-missing-number": "7"
  };
  for (const [id, expected] of Object.entries(answers)) {
    const { generated } = libraryQuestion(id, "en");
    assert.equal(generated.options[generated.correctIndex], expected, id);
  }
  assert.equal(libraryQuestion("maths-decimal-compare", "nb").generated.options[
    libraryQuestion("maths-decimal-compare", "nb").generated.correctIndex], "0,7");
});
