import React, { useEffect } from 'react';
import { useLabStore } from './store/useLabStore';
import { Sidebar } from './components/Layout/Sidebar';
import { Header } from './components/Layout/Header';
import { ProjectView } from './components/Views/ProjectView';
import { AllProjectsView } from './components/Views/AllProjectsView';
import { PapersOverviewView } from './components/Views/PapersOverviewView';
import { CalendarView } from './components/Views/CalendarView';
import { GanttView } from './components/Views/GanttView';
import { SettingsView } from './components/Views/SettingsView';
import { ExperimentModal } from './components/Modal/ExperimentModal';
import { GlobalDialogModal } from './components/Modal/GlobalDialogModal';
import { UpdatePrompt } from './components/Modal/UpdatePrompt';

export const App: React.FC = () => {
  const { view, isLoading, loadError, fetchInitialState, isDarkMode } = useLabStore();

  useEffect(() => {
    fetchInitialState();
  }, [fetchInitialState]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg)] text-[var(--mut)] text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[var(--acc)] border-t-transparent rounded-full animate-spin" />
          <span>Loading Lab Notebook...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <Header />

        {loadError && (
          <div className="px-4 py-2 text-xs bg-[var(--sel)] text-[var(--ink)] border-b border-[var(--line)]">
            {loadError}
          </div>
        )}

        <div className="flex-1 flex overflow-hidden relative z-0">
          {view.type === 'p' && <ProjectView />}
          {view.type === 'all' && <AllProjectsView />}
          {view.type === 'pp' && <PapersOverviewView />}
          {view.type === 'calendar' && <CalendarView />}
          {view.type === 'gantt' && <GanttView />}
          {view.type === 'settings' && <SettingsView />}
        </div>
      </main>

      {/* ELN Experiment Editor Modal */}
      <ExperimentModal />

      {/* In-page Dialog Popups (Confirm, Prompt, Alert) */}
      <GlobalDialogModal />

      {/* Corner card for an installed build with a newer release on GitHub */}
      <UpdatePrompt />
    </div>
  );
};

export default App;
