import type { AgentType, StageId } from '@forgemind/contract';

export const stageLabels: Record<StageId, string> = {
  inspection: 'Inspection',
  planning: 'Planning',
  implementation: 'Implementation',
  testing: 'Testing',
  review: 'Review',
  verification: 'Verification',
  approval: 'Approval',
};

export const agentLabels: Record<AgentType, string> = {
  orchestrator: 'Orchestrator',
  architect: 'Architect',
  developer: 'Developer',
  testing: 'Testing agent',
  security: 'Security agent',
  review: 'Review agent',
  release: 'Release agent',
};
