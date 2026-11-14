import type { Language } from "./contracts.js";

export interface LearningTopic {
  id: string;
  en: string;
  nb: string;
  guidance: string;
  mathVisual?: "array" | "fraction" | "numberLine";
}

const topics: Record<string, LearningTopic[]> = {
  Maths: [
    { id: "equal-groups", en: "Equal groups", nb: "Like grupper", guidance: "Explore multiplication as equal rows or groups.", mathVisual: "array" },
    { id: "fractions", en: "Parts of a whole", nb: "Deler av en helhet", guidance: "Explore fractions as equal parts of a whole.", mathVisual: "fraction" },
    { id: "number-line", en: "Number line jumps", nb: "Hopp på tallinjen", guidance: "Explore the distance between two numbers on a number line.", mathVisual: "numberLine" }
  ],
  Science: [
    { id: "living-things", en: "Living things", nb: "Levende ting", guidance: "Explore a simple relationship between living things and their environment." },
    { id: "materials", en: "Materials and changes", nb: "Stoffer og forandringer", guidance: "Explore a familiar material or a simple change of state." },
    { id: "earth-space", en: "Earth and space", nb: "Jorda og verdensrommet", guidance: "Explore a basic, well-established Earth or space concept." },
    { id: "forces", en: "Forces and motion", nb: "Krefter og bevegelse", guidance: "Explore a simple push, pull or motion." }
  ],
  English: [
    { id: "words", en: "Words and meaning", nb: "Ord og betydning", guidance: "Explore vocabulary through context." },
    { id: "sentences", en: "Building sentences", nb: "Bygge setninger", guidance: "Explore a simple grammatical choice in a sentence." },
    { id: "reading", en: "Reading for meaning", nb: "Forstå det vi leser", guidance: "Explore meaning or inference using a very short original passage." },
    { id: "story", en: "Story craft", nb: "Fortellinger", guidance: "Explore a character, setting or sequence in a short original story." }
  ],
  Norsk: [
    { id: "words", en: "Words and meaning", nb: "Ord og betydning", guidance: "Explore Norwegian vocabulary through context." },
    { id: "sentences", en: "Building sentences", nb: "Bygge setninger", guidance: "Explore a simple Norwegian grammatical choice in a sentence." },
    { id: "reading", en: "Reading for meaning", nb: "Forstå det vi leser", guidance: "Explore meaning or inference using a very short original Norwegian passage." },
    { id: "story", en: "Story craft", nb: "Fortellinger", guidance: "Explore a character, setting or sequence in a short original Norwegian story." }
  ],
  Geography: [
    { id: "maps", en: "Maps and places", nb: "Kart og steder", guidance: "Explore a simple map direction or location using clearly labelled clues." },
    { id: "landscapes", en: "Landscapes", nb: "Landskap", guidance: "Explore a familiar landform or body of water." },
    { id: "environment", en: "People and environment", nb: "Mennesker og miljø", guidance: "Explore a simple relationship between people and their surroundings." }
  ],
  History: [
    { id: "time", en: "Time and change", nb: "Tid og forandring", guidance: "Explore before and after using a simple, accurate sequence." },
    { id: "sources", en: "Clues from the past", nb: "Spor fra fortiden", guidance: "Explore what a historical object or source can and cannot tell us." },
    { id: "daily-life", en: "Life in the past", nb: "Livet før", guidance: "Explore an accurately described aspect of daily life in the past." }
  ],
  Piano: [
    { id: "notes", en: "Note names", nb: "Notenavn", guidance: "Explore basic piano note names." },
    { id: "rhythm", en: "Rhythm", nb: "Rytme", guidance: "Explore basic beats and simple rhythm patterns." },
    { id: "keys", en: "Keyboard patterns", nb: "Mønstre på tangentene", guidance: "Explore the pattern of piano keys using clear text labels." }
  ],
  "Music theory": [
    { id: "notes", en: "Note names", nb: "Notenavn", guidance: "Explore basic note names." },
    { id: "rhythm", en: "Rhythm", nb: "Rytme", guidance: "Explore simple rhythm and beats." }
  ]
};

const languageTopics: LearningTopic[] = [
  { id: "greetings", en: "Greetings", nb: "Hilsener", guidance: "Explore a simple greeting in the chosen language." },
  { id: "everyday-words", en: "Everyday words", nb: "Hverdagsord", guidance: "Explore a few familiar words in the chosen language." },
  { id: "short-dialogue", en: "Little conversations", nb: "Små samtaler", guidance: "Explore a short, simple dialogue in the chosen language." }
];

export function chooseLearningTopic(subject: string, recentTopics: string[], supportsNumberLine = true): LearningTopic {
  const choices = topics[subject] ?? (["Spanish", "French", "German"].includes(subject) ? languageTopics : undefined);
  if (!choices?.length) throw new Error("No learning topics for this subject.");
  const last = recentTopics.at(-1);
  const index = choices.findIndex((topic) => topic.id === last);
  for (let offset = 1; offset <= choices.length; offset++) {
    const candidate = choices[(index + offset) % choices.length]!;
    if (supportsNumberLine || candidate.mathVisual !== "numberLine") return candidate;
  }
  throw new Error("No supported learning topics for this subject.");
}

export function topicLabel(topic: LearningTopic, language: Language): string {
  return topic[language];
}
