import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

interface ProjectDetail {
  members: { userId: string; role: string }[];
}

const ROLE_RANK: Record<string, number> = {
  viewer: 0, editor: 1, manager: 2, admin: 3,
};

export function useProjectRole(projectId: string | undefined) {
  const user          = useAuthStore(s => s.user);
  const projectRoles  = useAuthStore(s => s.projectRoles);
  const setProjectRole = useAuthStore(s => s.setProjectRole);

  const { data } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`projects/${projectId}`),
    enabled: !!projectId && !!user,
    staleTime: 60_000,
  });

  const role = data?.members.find(m => m.userId === user?.id)?.role
    ?? projectRoles[projectId ?? '']
    ?? null;

  useEffect(() => {
    if (role && projectId) setProjectRole(projectId, role);
  }, [role, projectId, setProjectRole]);

  return {
    role,
    isAdmin:    !!role && ROLE_RANK[role] >= ROLE_RANK['admin'],
    isManager:  !!role && ROLE_RANK[role] >= ROLE_RANK['manager'],
    isEditor:   !!role && ROLE_RANK[role] >= ROLE_RANK['editor'],
    isViewer:   !!role,
    // Managers oversee runs but don't execute them — only editors and admins can run cases
    canExecute: role === 'editor' || role === 'admin',
  };
}
