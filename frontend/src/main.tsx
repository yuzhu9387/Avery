import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import App from './App'
import LoginPage from './pages/LoginPage'
import { CalendarOverlayShell } from './components/CalendarOverlayShell'
import AccountPage from './pages/AccountPage'
import EventDetailPage from './pages/EventDetailPage'
import EventsListPage from './pages/EventsListPage'
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
  // Its own URL, deliberately outside the App layout: the login screen must render
  // without the app header/rail, and needs an address of its own so the backend's
  // OAuth callback can redirect to `/login?link_token=...` as a real page.
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <WeekPage /> },
      { path: 'month', element: <MonthPage /> },
      // Every other page opens as a full-bleed sub-window over the calendar rather
      // than navigating away from it — see CalendarOverlayShell, which renders
      // WeekPage (sidebar included) as the base underneath and these routes as its
      // Outlet, so the sidebar is universal across the whole app.
      {
        element: <CalendarOverlayShell />,
        children: [
          { path: 'events', element: <EventsListPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'routine', element: <RoutinePage /> },
          { path: 'rules', element: <RulesPage /> },
          { path: 'account', element: <AccountPage /> },
          { path: 'tasks/:taskId', element: <TaskDetailPage /> },
          { path: 'events/:eventId', element: <EventDetailPage /> },
        ],
      },
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
