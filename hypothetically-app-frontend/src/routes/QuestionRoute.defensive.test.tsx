import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionRoute, validateAnswer } from './QuestionRoute'

const mocks = vi.hoisted(() => ({
  questionQuery: {
    data: {
      key: 'daily-test',
      prompt: 'How many doors?',
      unit: 'doors',
      minimum: 0,
      maximum: 100,
      step: 1,
      precision: 0,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  userQuery: {
    data: { firstName: 'Alex', lastInitial: 'A', displayName: 'Alex A.' },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  resultQuery: {
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  resultQueryFn: undefined as (() => unknown) | undefined,
  mutationFn: undefined as ((value: number) => unknown) | undefined,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey: unknown[]; queryFn: () => unknown }) => {
    if (options.queryKey[0] === 'question') return mocks.questionQuery
    if (options.queryKey[0] === 'current-user') return mocks.userQuery
    mocks.resultQueryFn = options.queryFn
    return mocks.resultQuery
  }),
  useMutation: vi.fn((options: { mutationFn: (value: number) => unknown }) => {
    mocks.mutationFn = options.mutationFn
    return {
      error: null,
      isPending: false,
      mutate: vi.fn(),
      reset: vi.fn(),
    }
  }),
}))

describe('QuestionRoute defensive callbacks', () => {
  beforeEach(() => {
    mocks.questionQuery.data = {
      key: 'daily-test',
      prompt: 'How many doors?',
      unit: 'doors',
      minimum: 0,
      maximum: 100,
      step: 1,
      precision: 0,
    }
    mocks.resultQueryFn = undefined
    mocks.mutationFn = undefined
  })

  it('validates non-finite input and guards mutation query callbacks without a question', () => {
    expect(validateAnswer(mocks.questionQuery.data, 'not-a-number')).toBe('Enter a real number.')
    const view = render(
      <MemoryRouter initialEntries={['/q/daily-test']}>
        <Routes><Route path="/q/:key" element={<QuestionRoute />} /></Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('spinbutton', { name: 'Your answer' })).toBeInTheDocument()

    mocks.questionQuery.data = undefined as never
    view.rerender(
      <MemoryRouter initialEntries={['/q/daily-test']}>
        <Routes><Route path="/q/:key" element={<QuestionRoute />} /></Routes>
      </MemoryRouter>,
    )
    expect(() => mocks.mutationFn?.(1)).toThrow('The question is not ready yet.')
    expect(() => mocks.resultQueryFn?.()).toThrow('The question is not ready yet.')
  })
})
