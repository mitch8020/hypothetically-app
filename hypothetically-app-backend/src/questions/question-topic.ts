export const QUESTION_TOPIC_VALUES = [
  'food',
  'sports',
  'home',
  'everyday',
  'creative',
  'nature',
  'other',
] as const;

export type QuestionTopic = (typeof QUESTION_TOPIC_VALUES)[number];

export const QUESTION_TOPIC_LABELS: Record<QuestionTopic, string> = {
  food: 'Food & drink',
  sports: 'Sports & movement',
  home: 'Home & objects',
  everyday: 'Everyday life',
  creative: 'Creative & culture',
  nature: 'Nature & animals',
  other: 'Other',
};

const CATALOG_TOPICS: Record<string, QuestionTopic> = {
  'fries-eaten': 'food',
  'cracker-tower': 'food',
  'grapes-one-hand': 'food',
  'marshmallows-in-mouth': 'food',
  'cereal-in-bowl': 'food',
  'ice-cubes-car-trunk': 'food',
  'jumping-jacks': 'sports',
  'one-foot-balance': 'sports',
  'tennis-ball-bounces': 'sports',
  'dogs-petted': 'nature',
  'rubber-ducks-bedroom': 'nature',
  'paper-airplanes': 'creative',
  'songs-recognized': 'creative',
  'photos-of-you': 'creative',
  'names-in-ten-minutes': 'creative',
  'sticky-notes-door': 'home',
  'pillows-in-room': 'home',
  'pencils-across-home': 'home',
  'paper-clips-phone': 'home',
  'doors-opened': 'everyday',
  'hours-in-lines': 'everyday',
  'already-in-your-hand': 'everyday',
  'choosing-what-to-watch': 'everyday',
  'balloons-with-feet': 'sports',
};

interface QuestionLike {
  key: string;
  prompt: string;
  unit: string;
}

export function questionTopic(question: QuestionLike): QuestionTopic {
  const catalogTopic = CATALOG_TOPICS[question.key];
  if (catalogTopic) return catalogTopic;

  const text = `${question.prompt} ${question.unit}`.toLowerCase();
  if (
    /food|eat|fries|grape|marshmallow|cereal|cracker|pizza|coffee|bowl/.test(
      text,
    )
  ) {
    return 'food';
  }
  if (/sport|run|jump|ball|bounce|balance|swim|bike|game/.test(text)) {
    return 'sports';
  }
  if (/animal|dog|cat|bird|fish|tree|flower|nature|garden/.test(text)) {
    return 'nature';
  }
  if (/room|house|home|bedroom|pillow|door|kitchen|car|desk|shelf/.test(text)) {
    return 'home';
  }
  if (/song|photo|fold|draw|paint|movie|watch|name|book|music/.test(text)) {
    return 'creative';
  }
  if (/^[a-z]/.test(text)) return 'everyday';
  return 'other';
}

export function isQuestionTopic(value: string): value is QuestionTopic {
  return (QUESTION_TOPIC_VALUES as readonly string[]).includes(value);
}
