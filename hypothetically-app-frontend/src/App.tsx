import { Route, Routes } from 'react-router'
import './App.css'
import { AppShell } from './components/AppShell'
import { HomeRoute } from './routes/HomeRoute'
import { QuestionRoute } from './routes/QuestionRoute'
import { ResultsRoute } from './routes/ResultsRoute'
import { ArchiveRoute } from './routes/ArchiveRoute'
import { NotFoundRoute } from './routes/StateRoutes'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeRoute />} />
        <Route path="q/:key" element={<QuestionRoute />} />
        <Route path="q/:key/results" element={<ResultsRoute />} />
        <Route path="archive" element={<ArchiveRoute />} />
        <Route path="*" element={<NotFoundRoute />} />
      </Route>
    </Routes>
  )
}

export default App
