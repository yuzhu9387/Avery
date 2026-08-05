import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import App from './App'
import MonthPage from './pages/MonthPage'
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
      { path: 'tasks', element: <Placeholder name="Tasks" /> },
      { path: 'tasks/:taskId', element: <Placeholder name="Task detail" /> },
      { path: 'template', element: <Placeholder name="Template" /> },
      { path: 'rules', element: <Placeholder name="Rules" /> },
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
