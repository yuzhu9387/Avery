import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import App from './App'
import EventDetailPage from './pages/EventDetailPage'
import MonthPage from './pages/MonthPage'
import ReviewPage from './pages/ReviewPage'
import RulesPage from './pages/RulesPage'
import TaskDetailPage from './pages/TaskDetailPage'
import TasksPage from './pages/TasksPage'
import TemplatePage from './pages/TemplatePage'
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
      { path: 'template', element: <TemplatePage /> },
      { path: 'rules', element: <RulesPage /> },
      { path: 'review', element: <ReviewPage /> },
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
