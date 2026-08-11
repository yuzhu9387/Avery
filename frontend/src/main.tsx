import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import App from './App'
import EventDetailPage from './pages/EventDetailPage'
import MonthPage from './pages/MonthPage'
import RoutinePage from './pages/RoutinePage'
import RulesPage from './pages/RulesPage'
import TaskDetailPage from './pages/TaskDetailPage'
import TasksPage from './pages/TasksPage'
import WeekPage from './pages/WeekPage'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <WeekPage /> },
      { path: 'events/:eventId', element: <EventDetailPage /> },
      { path: 'month', element: <MonthPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'tasks/:taskId', element: <TaskDetailPage /> },
      { path: 'routine', element: <RoutinePage /> },
      { path: 'rules', element: <RulesPage /> },
      // The Review route is off for now. `pages/ReviewPage.tsx`, `hooks/useReports.ts`
      // and `components/GroupChart.tsx` are deliberately left on disk, and the
      // backend's /api/reports is untouched, so putting it back is this line plus
      // the nav entry in App.tsx.
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
