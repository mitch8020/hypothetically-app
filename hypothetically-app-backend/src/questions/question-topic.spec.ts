import {
  isQuestionTopic,
  questionTopic,
  QUESTION_TOPIC_VALUES,
} from './question-topic';

describe('question topics', () => {
  it('maps catalog questions and keyword families', () => {
    expect(questionTopic({ key: 'doors-opened', prompt: '', unit: '' })).toBe(
      'everyday',
    );
    expect(
      questionTopic({
        key: 'new',
        prompt: 'How many pizzas could you eat?',
        unit: 'slices',
      }),
    ).toBe('food');
    expect(
      questionTopic({
        key: 'new',
        prompt: 'How many jumps can you make?',
        unit: 'jumps',
      }),
    ).toBe('sports');
    expect(
      questionTopic({
        key: 'new',
        prompt: 'How many dogs are in a park?',
        unit: 'dogs',
      }),
    ).toBe('nature');
    expect(
      questionTopic({
        key: 'new',
        prompt: 'How many pillows fit in a room?',
        unit: 'pillows',
      }),
    ).toBe('home');
    expect(
      questionTopic({
        key: 'new',
        prompt: 'How many songs could you name?',
        unit: 'songs',
      }),
    ).toBe('creative');
    expect(
      questionTopic({
        key: 'new',
        prompt: 'How many candles are nearby?',
        unit: 'candles',
      }),
    ).toBe('everyday');
    expect(questionTopic({ key: 'new', prompt: '!!!', unit: '123' })).toBe(
      'other',
    );
  });

  it('recognizes exactly the supported topic values', () => {
    for (const value of QUESTION_TOPIC_VALUES) {
      expect(isQuestionTopic(value)).toBe(true);
    }
    expect(isQuestionTopic('all')).toBe(false);
    expect(isQuestionTopic('')).toBe(false);
  });
});
