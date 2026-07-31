import type { ArgumentsHost, ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { Profile } from 'passport-google-oauth20'
import type { Model } from 'mongoose'
import { Types } from 'mongoose'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AuthController } from './auth/auth.controller'
import { AuthSessionService } from './auth/auth-session.service'
import { GoogleAuthGuard } from './auth/google-auth.guard'
import { GoogleCallbackExceptionFilter } from './auth/google-callback-exception.filter'
import { GoogleStrategy } from './auth/google.strategy'
import { SessionAuthGuard } from './auth/session-auth.guard'
import { SessionSerializer } from './auth/session.serializer'
import { mutationOriginGuard } from './security/mutation-origin.middleware'
import { User } from './users/schemas/user.schema'
import { UsersService } from './users/users.service'

function executionContext(request: Request): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

function requestWithSession(overrides: Partial<Request> = {}): Request {
  return {
    session: {
      regenerate: (done: (error?: unknown) => void) => done(),
      destroy: (done: (error?: unknown) => void) => done(),
      returnTo: undefined,
    },
    login: (_user: Express.User, done: (error?: unknown) => void) => done(),
    logout: (done: (error?: unknown) => void) => done(),
    isAuthenticated: () => true,
    ...overrides,
  } as unknown as Request
}

describe('small backend units', () => {
  it('covers the health controller and service', () => {
    const service = new AppService()
    expect(service.getHealth()).toEqual({ status: 'ok', service: 'hypothetically-app-backend' })
    expect(new AppController(service).getHealth()).toEqual(service.getHealth())
  })

  it('runs authentication session operations and translates callback failures', async () => {
    const service = new AuthSessionService()
    const user = { _id: new Types.ObjectId(), firstName: 'Alex', lastInitial: 'A' } as Express.User
    const request = requestWithSession()
    await expect(service.signIn(request, user)).resolves.toBeUndefined()
    await expect(service.signOut(request)).resolves.toBeUndefined()

    const regenerateError = requestWithSession({
      session: { regenerate: (done) => done(new Error('renewed')), destroy: (done) => done() } as never,
    })
    await expect(service.signIn(regenerateError, user)).rejects.toThrow('renewed')
    const loginError = requestWithSession({
      login: (_user, done) => done('login failed'),
    })
    await expect(service.signIn(loginError, user)).rejects.toThrow('Could not complete sign-in.')
    const logoutError = requestWithSession({ logout: (done) => done(new Error('logout failed')) })
    await expect(service.signOut(logoutError)).rejects.toThrow('logout failed')
    const destroyError = requestWithSession({
      session: { regenerate: (done) => done(), destroy: (done) => done('destroy failed') } as never,
    })
    await expect(service.signOut(destroyError)).rejects.toThrow('Could not clear the session.')
  })

  it('covers the auth controller success, failure, and session views', async () => {
    const redirect = jest.fn()
    const clearCookie = jest.fn()
    const status = jest.fn().mockReturnThis()
    const send = jest.fn()
    const response = { redirect, clearCookie, status, send } as unknown as Response
    const config = { getOrThrow: jest.fn(() => 'http://localhost:7073') } as unknown as ConfigService
    const toPublicUser = jest.fn((user: Express.User) => ({ firstName: user.firstName, lastInitial: user.lastInitial, displayName: user.firstName }))
    const users = { toPublicUser } as unknown as UsersService
    const authSession = { signIn: jest.fn(), signOut: jest.fn() } as unknown as AuthSessionService
    const controller = new AuthController(config, users, authSession)
    const user = { _id: new Types.ObjectId(), firstName: 'Alex', lastInitial: 'A' } as Express.User

    expect(controller.me(requestWithSession({ user: undefined }))).toEqual({ user: null })
    expect(controller.me(requestWithSession({ user }))).toEqual({ user: { firstName: 'Alex', lastInitial: 'A', displayName: 'Alex' } })
    expect(controller.google()).toBeUndefined()

    await controller.googleCallback(requestWithSession({ user: undefined }), response)
    expect(redirect).toHaveBeenCalledWith('http://localhost:7073/?auth=failed')
    redirect.mockClear()
    const signedInRequest = requestWithSession({ user, session: { ...requestWithSession().session, returnTo: '/q/daily-test' } as never })
    await controller.googleCallback(signedInRequest, response)
    expect(authSession.signIn).toHaveBeenCalledWith(signedInRequest, user)
    expect(redirect).toHaveBeenCalledWith('http://localhost:7073/q/daily-test')
    await controller.googleCallback(requestWithSession({ user }), response)
    expect(redirect).toHaveBeenLastCalledWith('http://localhost:7073/')

    await controller.logout(requestWithSession(), response)
    expect(authSession.signOut).toHaveBeenCalled()
    expect(clearCookie).toHaveBeenCalledWith('hmt.sid')
    expect(status).toHaveBeenCalledWith(204)
    expect(send).toHaveBeenCalled()
  })

  it('validates Google return paths and session authentication', () => {
    const guard = new GoogleAuthGuard()
    const allowed = requestWithSession({ query: { returnTo: '/q/daily-test/results' } } as never)
    expect(guard.getAuthenticateOptions(executionContext(allowed))).toEqual({ scope: ['openid', 'profile'], state: true })
    expect(allowed.session.returnTo).toBe('/q/daily-test/results')
    const rejected = requestWithSession({ query: { returnTo: 'https://attacker.example' } } as never)
    guard.getAuthenticateOptions(executionContext(rejected))
    expect(rejected.session.returnTo).toBe('/')
    const missing = requestWithSession({ query: {} } as never)
    guard.getAuthenticateOptions(executionContext(missing))
    expect(missing.session.returnTo).toBe('/')

    const sessionGuard = new SessionAuthGuard()
    expect(sessionGuard.canActivate(executionContext(requestWithSession({ isAuthenticated: () => true })))).toBe(true)
    expect(sessionGuard.canActivate(executionContext(requestWithSession({ isAuthenticated: () => false })))).toBe(false)
  })

  it('redirects OAuth callback exceptions to the saved or default route', () => {
    const redirect = jest.fn()
    const filter = new GoogleCallbackExceptionFilter({ getOrThrow: jest.fn(() => 'http://localhost:7073') } as unknown as ConfigService)
    const host = (request: Request) => ({
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ redirect }) }),
    }) as unknown as ArgumentsHost
    filter.catch(new Error('oauth failed'), host(requestWithSession({ session: { returnTo: '/q/daily-test' } as never })))
    expect(redirect).toHaveBeenCalledWith('http://localhost:7073/q/daily-test?auth=failed')
    redirect.mockClear()
    filter.catch('oauth failed', host(requestWithSession()))
    expect(redirect).toHaveBeenCalledWith('http://localhost:7073/?auth=failed')
  })

  it('maps Google profiles into user records with all profile fallbacks', async () => {
    const upsertGoogleProfile = jest.fn().mockImplementation(async (profile) => ({ ...profile, _id: new Types.ObjectId() }))
    const strategy = new GoogleStrategy(
      { getOrThrow: jest.fn((key: string) => ({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_CALLBACK_URL: 'http://localhost/callback' })[key]) } as unknown as ConfigService,
      { upsertGoogleProfile } as unknown as UsersService,
    )
    const detailed = { id: 'google-1', displayName: 'Display Name', name: { givenName: ' Jane ', familyName: ' doe ' }, photos: [{ value: 'https://avatar' }] } as unknown as Profile
    await expect(strategy.validate('', '', detailed)).resolves.toMatchObject({ googleSubject: 'google-1', firstName: 'Jane', lastInitial: 'D', avatarUrl: 'https://avatar' })
    const fallback = { id: 'google-2', displayName: 'Solo Player', name: {}, photos: [] } as unknown as Profile
    await expect(strategy.validate('', '', fallback)).resolves.toMatchObject({ googleSubject: 'google-2', firstName: 'Solo', lastInitial: '' })
    const player = { id: 'google-3', displayName: '', photos: [] } as unknown as Profile
    await expect(strategy.validate('', '', player)).resolves.toMatchObject({ firstName: 'Player', lastInitial: '' })
  })

  it('serializes, deserializes, and reports missing or failed users', async () => {
    const id = new Types.ObjectId()
    const user = { _id: id, firstName: 'Alex', lastInitial: 'A' } as Express.User
    const findById = jest.fn()
    const serializer = new SessionSerializer({ findById } as unknown as UsersService)
    const serializeDone = jest.fn()
    serializer.serializeUser(user, serializeDone)
    expect(serializeDone).toHaveBeenCalledWith(null, id.toString())
    const done = jest.fn()
    findById.mockResolvedValueOnce(user).mockResolvedValueOnce(null)
    await serializer.deserializeUser(id.toString(), done)
    expect(done).toHaveBeenLastCalledWith(null, user)
    await serializer.deserializeUser(id.toString(), done)
    expect(done).toHaveBeenLastCalledWith(null, false)
    findById.mockRejectedValueOnce(new Error('database down'))
    await serializer.deserializeUser(id.toString(), done)
    expect(done).toHaveBeenLastCalledWith(expect.any(Error))
  })

  it('covers user persistence, ID validation, and public projections', async () => {
    const exec = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() })
    const orFail = jest.fn().mockReturnValue({ exec })
    const findOneAndUpdate = jest.fn().mockReturnValue({ orFail })
    const findById = jest.fn().mockReturnValue({ exec })
    const service = new UsersService({ findOneAndUpdate, findById } as unknown as Model<User>)
    const profile = { googleSubject: 'subject', firstName: 'Alex', lastInitial: 'a' }
    await expect(service.upsertGoogleProfile(profile)).resolves.toMatchObject({ _id: expect.any(Object) })
    expect(findOneAndUpdate).toHaveBeenCalledWith({ googleSubject: 'subject' }, { $set: profile }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true })
    await expect(service.findById('not-an-object-id')).resolves.toBeNull()
    const id = new Types.ObjectId().toString()
    await expect(service.findById(id)).resolves.toBeTruthy()
    expect(service.toPublicUser({ firstName: 'Alex', lastInitial: 'a', avatarUrl: 'https://avatar' } as Express.User)).toEqual({ firstName: 'Alex', lastInitial: 'A', displayName: 'Alex A.', avatarUrl: 'https://avatar' })
    expect(service.toPublicUser({ firstName: 'Solo', lastInitial: '' } as Express.User)).toEqual({ firstName: 'Solo', lastInitial: '', displayName: 'Solo' })
  })

  it('blocks cross-origin mutations while allowing safe requests', () => {
    const next = jest.fn()
    const status = jest.fn().mockReturnThis()
    const json = jest.fn()
    const guard = mutationOriginGuard('http://localhost:7073')
    guard({ method: 'GET', headers: {} } as Request, { status, json } as unknown as Response, next)
    guard({ method: 'POST', headers: { origin: 'http://localhost:7073' } } as Request, { status, json } as unknown as Response, next)
    guard({ method: 'POST', headers: {} } as Request, { status, json } as unknown as Response, next)
    expect(next).toHaveBeenCalledTimes(2)
    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith({ code: 'INVALID_ORIGIN', message: 'This request did not come from the app.' })
  })
})
