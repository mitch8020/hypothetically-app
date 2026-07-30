export interface CatalogQuestion {
  key: string;
  prompt: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
  precision: number;
  active: true;
}

const DEFAULT_MAXIMUM = 1_000_000_000;

function whole(
  key: string,
  prompt: string,
  unit: string,
  maximum = DEFAULT_MAXIMUM,
): CatalogQuestion {
  return {
    key,
    prompt,
    unit,
    minimum: 0,
    maximum,
    step: 1,
    precision: 0,
    active: true,
  };
}

export const QUESTION_CATALOG: readonly CatalogQuestion[] = [
  whole(
    'doors-opened',
    'How many doors do you think you’ve opened in your lifetime?',
    'doors',
  ),
  whole(
    'fries-eaten',
    'How many french fries do you think you’ve eaten last month?',
    'fries',
  ),
  whole(
    'hours-in-lines',
    'How many hours have you spent in your life waiting in lines?',
    'hours',
  ),
  whole(
    'dogs-petted',
    'How many different dogs have you petted this year?',
    'dogs',
  ),
  whole(
    'already-in-your-hand',
    'How many times have you searched for something already in your hand in your life?',
    'times',
  ),
  whole(
    'songs-recognized',
    'How many songs could you recognize from the first five seconds?',
    'songs',
  ),
  whole(
    'photos-of-you',
    'How many photos of you do you think exist in your lifetime?',
    'photos',
  ),
  whole(
    'choosing-what-to-watch',
    'How many total minutes have you spent deciding what to watch in your lifetime?',
    'minutes',
  ),
  whole(
    'paper-airplanes',
    'How many paper airplanes could you fold in one hour?',
    'airplanes',
  ),
  whole(
    'jumping-jacks',
    'How many jumping jacks could you do without stopping?',
    'jumping jacks',
  ),
  whole(
    'balloons-with-feet',
    'How many balloons could you pop in one minute using only your feet?',
    'balloons',
  ),
  whole(
    'one-foot-balance',
    'How many seconds could you balance on one foot with your eyes closed?',
    'seconds',
  ),
  whole(
    'names-in-ten-minutes',
    'How many famous people could you name from memory in ten minutes?',
    'people',
  ),
  whole(
    'cracker-tower',
    'How many crackers could you stack before the tower fell?',
    'crackers',
  ),
  whole(
    'tennis-ball-bounces',
    'How many times could you bounce a tennis ball in sixty seconds?',
    'bounces',
  ),
  whole(
    'rubber-ducks-bedroom',
    'How many rubber ducks could fit in your bedroom without stacking?',
    'ducks',
  ),
  whole(
    'sticky-notes-door',
    'How many sticky notes would cover one side of your house?',
    'notes',
  ),
  whole(
    'grapes-one-hand',
    'How many grapes could you hold in one hand?',
    'grapes',
  ),
  whole(
    'marshmallows-in-mouth',
    'How many marshmallows could you fit in your mouth at once?',
    'marshmallows',
  ),
  whole(
    'cereal-in-bowl',
    'How many cereal pieces would fit in your favorite bowl?',
    'pieces',
  ),
  whole(
    'pillows-in-room',
    'How many standard pillows would fill the room you’re in?',
    'pillows',
  ),
  whole(
    'pencils-across-home',
    'How many pencils laid end to end would it take to visit each room in your home?',
    'pencils',
  ),
  whole(
    'paper-clips-phone',
    'How many paper clips would weigh the same as you do?',
    'paper clips',
  ),
  whole(
    'ice-cubes-car-trunk',
    'How many ice cubes would fit in the trunk of a car?',
    'ice cubes',
  ),
] as const;
