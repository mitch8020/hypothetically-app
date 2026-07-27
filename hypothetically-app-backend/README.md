# How Many, Though? API

NestJS, MongoDB, Mongoose, Passport, and server sessions power the guessing
loop. The API seeds the fixed 24-question catalog without deleting existing
records and stores one immutable answer per user and question.

## Local configuration

Copy `.env.example` to the ignored `.env` file and set every value:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/how-many-though
MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=use-a-long-random-secret
FRONTEND_URL=http://localhost:7073
GOOGLE_CALLBACK_URL=http://localhost:7000/api/auth/google/callback
PORT=7000
```

`MONGODB_DNS_SERVERS` is optional. It is useful on Windows when Node reports a
`querySrv ECONNREFUSED` error for an Atlas `mongodb+srv` URI; omit it when the
normal system resolver works.

Register this exact local redirect URI in the Google OAuth client:

```text
http://localhost:7000/api/auth/google/callback
```

The app requests only `openid profile`. It does not save Google tokens, email,
or full surnames.

## Commands

```powershell
npm.cmd install
npm.cmd run start:dev
npm.cmd run lint
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand
npm.cmd run build
```

The `/api/test/auth/:subject` adapter is registered only when both
`NODE_ENV=test` and `ENABLE_TEST_AUTH=true`. It is used for browser tests and
cannot be enabled in a production process.
