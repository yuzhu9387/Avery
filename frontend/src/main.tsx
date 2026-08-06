import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import App from './App'
import MonthPage from './pages/MonthPage'
import RulesPage from './pages/RulesPage'
import TaskDetailPage from './pages/TaskDetailPage'
import TasksPage from './pages/TasksPage'
import TemplatePage from './pages/TemplatePage'
import WeekPage from './pages/WeekPage'
import './index.css'

const Placeholder = ({ name }: { name: string }) => (
  <div className="p-8 text-ink-muted">{name}</div>
)

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <WeekPage /> },
      { path: 'month', element: <MonthPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'tasks/:taskId', element: <TaskDetailPage /> },
      { path: 'template', element: <TemplatePage /> },
      { path: 'rules', element: <RulesPage /> },
      { path: 'review', element: <Placeholder name="Review" /> },
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
