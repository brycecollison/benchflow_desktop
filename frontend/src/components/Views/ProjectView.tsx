import React from 'react';
import { useLabStore } from '../../store/useLabStore';
import { FlowCanvas } from '../FlowCanvas/FlowCanvas';

export const ProjectView: React.FC = () => {
  const { projects, papers, view } = useLabStore();

  const currentProject = projects.find((p) => p.id === view.id);

  if (!currentProject) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-[var(--mut)] text-sm italic">
        Create a project with “+” in the sidebar to begin.
      </div>
    );
  }

  return <FlowCanvas project={currentProject} papers={papers} />;
};
