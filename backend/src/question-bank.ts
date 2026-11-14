import { InputValidationError, type Language } from "./contracts.js";
import { QuizNotFoundError, validateGeneratedQuiz, type GeneratedQuiz, type QuizVisual } from "./quiz.js";
import { authoredQuestions } from "./question-bank-data.js";

export const librarySubjects = [
  "Maths", "Space", "Nature", "Coding", "Art", "Norsk", "Science", "Geography", "History",
  "English", "Piano", "Music theory", "French", "Spanish", "German", "Media literacy"
] as const;
export type LibrarySubject = typeof librarySubjects[number];
export type LanguagePair = readonly [string, string];
export type AuthoredText = readonly [
  question: string, correct: string, alternatives: readonly [string, string, string],
  hint: string, explanation: string
];
export interface AuthoredQuestion {
  id: string;
  subject: LibrarySubject;
  level: 1 | 2 | 3;
  goal: LanguagePair;
  text: readonly [AuthoredText, AuthoredText];
  visual?: readonly [QuizVisual, QuizVisual];
}

function visualMaths(): AuthoredQuestion[] {
  const questions: AuthoredQuestion[] = [];
  function add(id: string, level: AuthoredQuestion["level"], goal: LanguagePair,
    en: AuthoredText, nb: AuthoredText, visual: QuizVisual) {
    questions.push({ id, subject: "Maths", level, goal, text: [en, nb], visual: [visual, visual] });
  }
  const groups = [[2, 2], [2, 3], [3, 3], [3, 4], [4, 4], [4, 5]] as const;
  for (const [rows, columns] of groups) {
    const total = rows * columns;
    const wrong: [string, string, string] = [String(total - 1), String(total + 1), String(total + columns)];
    add(`maths-groups-${rows}-${columns}`, rows < 3 ? 1 : 2,
      ["Count equal groups", "Tell like grupper"],
      [`There are ${rows} rows with ${columns} stars in each row. How many stars altogether?`, String(total), wrong,
        "Count one row, then count that many for every row.",
        `${rows} equal rows of ${columns} make ${rows} × ${columns} = ${total} stars.`],
      [`Det er ${rows} rader med ${columns} stjerner i hver rad. Hvor mange stjerner er det til sammen?`, String(total), wrong,
        "Tell én rad, og tell like mange for hver av radene.",
        `${rows} like rader med ${columns} gir ${rows} × ${columns} = ${total} stjerner.`],
      { kind: "array", rows, columns, icon: "star" });
  }
  const jumps = [[1, 4], [2, 7], [3, 8], [0, 6], [4, 9], [5, 10]] as const;
  for (const [from, to] of jumps) {
    const distance = to - from;
    const wrong: [string, string, string] = [String(distance - 1), String(distance + 1), String(distance + 2)];
    add(`maths-line-${from}-${to}`, from === 0 ? 1 : 2,
      ["Measure a number-line jump", "Mål et hopp på tallinjen"],
      [`A little robot jumps from ${from} to ${to}. How many one-step jumps does it make?`, String(distance), wrong,
        "Count the spaces between the start and the end, not the number of labels.",
        `The distance is ${to} − ${from} = ${distance}. Count each space once; the starting label is not a jump.`],
      [`En liten robot hopper fra ${from} til ${to}. Hvor mange hopp på ett trinn gjør den?`, String(distance), wrong,
        "Tell mellomrommene mellom start og slutt, ikke antallet tall.",
        `Avstanden er ${to} − ${from} = ${distance}. Tell hvert mellomrom én gang; starttallet er ikke et hopp.`],
      { kind: "numberLine", from, to });
  }
  const fractions = [[2, 1], [3, 2], [4, 3], [5, 2], [6, 3], [8, 5], [6, 4], [8, 2]] as const;
  for (const [parts, filled] of fractions) {
    const alternatives = Array.from({ length: parts + 1 }, (_, n) => n)
      .filter(n => n !== filled).slice(0, 3).map(n => `${n}/${parts}`);
    const wrong: [string, string, string] = parts === 2
      ? ["0/2", "2/2", "3/2"] : [alternatives[0]!, alternatives[1]!, alternatives[2]!];
    add(`maths-parts-${filled}-${parts}`, parts < 5 ? 1 : 2,
      ["Describe equal parts of a whole", "Beskriv like deler av en helhet"],
      [`This picture has ${parts} equal parts and ${filled} are filled. Which fraction is filled?`, `${filled}/${parts}`, wrong,
        "The bottom number counts all equal parts. The top number counts only the filled parts.",
        `${filled} of the ${parts} equal parts are filled, so the picture shows ${filled}/${parts}.`],
      [`Bildet har ${parts} like deler, og ${filled} er fargelagt. Hvilken brøk er fargelagt?`, `${filled}/${parts}`, wrong,
        "Tallet nederst teller alle de like delene. Tallet øverst teller bare de fargelagte delene.",
        `${filled} av de ${parts} like delene er fargelagt, så bildet viser ${filled}/${parts}.`],
      { kind: "fraction", parts, filled });
  }
  return questions;
}

export const questionBank: readonly AuthoredQuestion[] = [...visualMaths(), ...authoredQuestions];
const byId = new Map(questionBank.map(question => [question.id, question]));

export function libraryLanguage(value: unknown): Language {
  if (value !== "en" && value !== "nb") throw new InputValidationError();
  return value;
}

export function libraryCatalog(language: Language) {
  const index = language === "nb" ? 1 : 0;
  const groups = librarySubjects.map(subject => questionBank.filter(question => question.subject === subject));
  const catalog = [];
  for (let position = 0; position < Math.max(...groups.map(group => group.length)); position++) {
    for (const group of groups) {
      const question = group[position];
      if (question) catalog.push({
        id: question.id, subject: question.subject, level: question.level,
        goal: question.goal[index], question: question.text[index][0]
      });
    }
  }
  return catalog;
}

export function libraryQuestion(id: string, language: Language): {
  subject: LibrarySubject; generated: GeneratedQuiz; libraryId: string; level: 1 | 2 | 3; hint: string;
} {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new InputValidationError();
  const question = byId.get(id);
  if (!question) throw new QuizNotFoundError();
  const index = language === "nb" ? 1 : 0;
  const [stem, correct, wrong, hint, explanation] = question.text[index];
  const correctIndex = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  const options: GeneratedQuiz["options"] = correctIndex === 0 ? [correct, ...wrong]
    : correctIndex === 1 ? [wrong[0], correct, wrong[1], wrong[2]]
    : correctIndex === 2 ? [wrong[0], wrong[1], correct, wrong[2]]
    : [...wrong, correct];
  const generated = validateGeneratedQuiz({
    question: stem, options, correctIndex, explanation, lesson: question.goal[index],
    ...(question.visual ? { visual: question.visual[index] } : {})
  });
  return { subject: question.subject, generated, libraryId: id, level: question.level, hint };
}
